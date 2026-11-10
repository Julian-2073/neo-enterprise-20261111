import asyncio, json, os, secrets
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime,timezone
from fastapi import FastAPI,HTTPException,Header,Depends
from pydantic import BaseModel
from dotenv import load_dotenv
from .contracts import Job,ScenarioAssumptions
from .ontology import expand_ontology
from .engine import simulate,compare,CalculationError,source_hash,evaluate_forecast
from .agent import AgentRuntime
from .providers import ProviderError
from .patrol import register_watch,enqueue_due
from .job_queue import JobQueue,QueueConflict,worker_id
from .runner import run_worker
from .knowledge_monitor import KnowledgeJob
from . import forecast_jobs
from . import operating_plans
from . import ontology_integrations

load_dotenv(Path(__file__).parent.parent/'.env')
def now():return datetime.now(timezone.utc).isoformat()
DB=os.getenv('NEO_AGENT_DB',str(Path(__file__).parent.parent/'state/agent.sqlite'))

def queue():return JobQueue(DB)

def status(ident):
    try:return queue().observe(ident)
    except KeyError:raise HTTPException(404,'任务不存在')

async def authorize(authorization:str=Header(default='')):
    token=os.getenv('NEO_SERVICE_TOKEN','')
    if not token or len(token)<32:raise HTTPException(503,'服务间认证未配置')
    if not secrets.compare_digest(authorization,'Bearer '+token):raise HTTPException(401,'服务间认证失败')

async def worker(lane=None):
    q=queue()
    def due():
        if os.getenv('LLM_API_KEY') and os.getenv('NEO_AUTO_PATROL','true')=='true':
            with q.db(immediate=True) as c:enqueue_due(c,now())
    await run_worker(q,worker_id(),auto_enqueue=due if lane!='interactive' else None,lane=lane)

@asynccontextmanager
async def lifespan(app):
    q=queue();q.initialize();q.recover()
    lanes=['interactive','background'] if os.getenv('NEO_AGENT_RESERVED_INTERACTIVE')=='true' else [None]
    tasks=[asyncio.create_task(worker(lane)) for lane in lanes] if os.getenv('NEO_AGENT_EXECUTION_MODE')!='offline' else []
    tasks.append(asyncio.create_task(forecast_jobs.worker()))
    try:yield
    finally:
        for task in tasks:task.cancel()
        for task in tasks:
            try:await task
            except asyncio.CancelledError:pass
app=FastAPI(title='NEO Agent Service',lifespan=lifespan,dependencies=[Depends(authorize)])
app.include_router(forecast_jobs.router)
app.include_router(operating_plans.router)
app.include_router(ontology_integrations.router)
@app.get('/health')
def health():return {'status':'ok','agentBudgetPolicy':'unlimited','executionMode':os.getenv('NEO_AGENT_EXECUTION_MODE','live'),'autoPatrolEnabled':os.getenv('NEO_AUTO_PATROL','true')=='true','queueVersion':'fenced-reserved-lanes-v3' if os.getenv('NEO_AGENT_RESERVED_INTERACTIVE')=='true' else 'fenced-single-worker-v2','ontologyVersion':'objectset-v1','policyVersion':'ontology-policy-v2','modelConfigured':bool(os.getenv('LLM_API_KEY') and os.getenv('LLM_MODEL')),'marketConfigured':bool(os.getenv('NEO_FIRECRAWL_MCP_COMMAND')) if os.getenv('NEO_MARKET_PROVIDER')=='firecrawl_mcp' else bool(os.getenv('TAVILY_API_KEY')),'marketProvider':os.getenv('NEO_MARKET_PROVIDER','tavily'), 'model':os.getenv('LLM_MODEL','')}
@app.post('/runs')
async def submit(job:Job):
    if os.getenv('NEO_AGENT_EXECUTION_MODE')=='offline':raise HTTPException(503,'当前离线版本只启用确定性计算；智能体调查需要正式运行模式与模型配置')
    # Omit the additive unset budget field to preserve legacy idempotency hashes.
    payload=job.model_dump(mode='json');
    if payload.get('budget') is None:payload.pop('budget',None)
    if payload.get('taskType') is None:payload.pop('taskType',None)
    if payload.get('recoveryFrom') is None:payload.pop('recoveryFrom',None)
    digest=source_hash(payload)
    try:
        if payload.get('recoveryFrom'):
            from .completed_recovery import prepare_completed_recovery
            await prepare_completed_recovery(queue(),payload)
        queue().submit(payload,digest,register=lambda c:register_watch(c,job,now()))
    except QueueConflict as e:raise HTTPException(409,str(e)) from e
    return status(job.id)

@app.get('/queue')
def queue_status():
    q=queue()
    with q.db() as c:
        rows=c.execute('SELECT status,count(*) count FROM jobs GROUP BY status').fetchall()
        queued=c.execute("SELECT id FROM jobs WHERE status='queued' ORDER BY priority DESC,COALESCE(queued_at,created_at),id LIMIT 30").fetchall()
    return {'counts':{r['status']:r['count'] for r in rows},'items':[q.observe(r['id']) for r in queued],
            'scheduler':'single-worker-nonpreemptive-interactive-first','autoPatrolEnabled':os.getenv('NEO_AUTO_PATROL','true')=='true'}
@app.get('/patrols/{snapshot_id}')
def patrols(snapshot_id:str,businessId:str):
    with queue().db() as c:rows=c.execute("SELECT id,payload,created_at FROM jobs WHERE json_extract(payload,'$.purpose')='patrol' AND json_extract(payload,'$.businessId')=? AND json_extract(payload,'$.snapshotId')=? ORDER BY created_at DESC LIMIT 10",(businessId,snapshot_id)).fetchall()
    return {'items':[{'id':r['id'],'createdAt':r['created_at'],'payload':json.loads(r['payload'])} for r in rows]}
@app.get('/runs/{ident}')
def get(ident:str):return status(ident)
@app.post('/runs/{ident}/cancel')
def cancel(ident:str):
    try:queue().cancel(ident)
    except KeyError:raise HTTPException(404,'任务不存在')
    return status(ident)
@app.post('/runs/{ident}/resume')
def resume(ident:str):
    if os.getenv('NEO_AGENT_EXECUTION_MODE')=='offline':raise HTTPException(503,'离线版本不恢复模型调查；已有记录保持不变')
    try:queue().resume(ident)
    except KeyError:raise HTTPException(404,'任务不存在')
    except QueueConflict as e:raise HTTPException(409,str(e)) from e
    return status(ident)
class CalculationInput(BaseModel):
    envelope:dict
    assumptions:ScenarioAssumptions=ScenarioAssumptions()
    forecast:dict|None=None
class ScenarioReplayInput(BaseModel):
    envelope:dict
    assumptions:dict
@app.post('/calculate/scenario-replay')
def replay_scenario(input:ScenarioReplayInput):
    from .scenario_options import scenario_replay
    try:return scenario_replay(expand_ontology(input.envelope),input.assumptions)
    except ValueError as e:raise HTTPException(422,str(e)) from e

@app.post('/calculate/{kind}')
def calculate(kind:str,input:CalculationInput):
    if kind not in ('forecast','scenario','forecast_evaluate'):raise HTTPException(404,'计算类型不存在')
    try:
        envelope=expand_ontology(input.envelope)
        if kind=='forecast_evaluate':
            if not input.forecast:raise CalculationError('需要已保存预测')
            return evaluate_forecast(envelope,input.forecast)
        return simulate(envelope) if kind=='forecast' else compare(envelope,input.assumptions.model_dump(mode='json'))
    except (CalculationError,ValueError) as e:raise HTTPException(422,str(e)) from e

@app.post('/knowledge-runs')
def submit_knowledge(job:KnowledgeJob):
    if os.getenv('NEO_AGENT_EXECUTION_MODE')=='offline':raise HTTPException(503,'离线不启动模型')
    payload=job.model_dump(mode='json')
    try:queue().submit(payload,source_hash(payload))
    except QueueConflict as e:raise HTTPException(409,str(e)) from e
    return status(job.id)

class SourceRead(BaseModel):
    url:str
    allowedHosts:list[str]|None=None
@app.post('/knowledge-source')
async def knowledge_source(input:SourceRead):
    from .source_fetch import fetch_knowledge_source
    import httpx
    hosts={'www.samr.gov.cn','openstd.samr.gov.cn','std.samr.gov.cn','www.mct.gov.cn','www.ndrc.gov.cn','www.gov.cn','www.miit.gov.cn','www.mofcom.gov.cn'}
    if input.allowedHosts is not None:hosts=set(input.allowedHosts)
    try:return await fetch_knowledge_source(input.url,hosts)
    except (ValueError,OSError,ProviderError,httpx.HTTPError) as e:raise HTTPException(502,str(e)) from e
