"""Real provider + durable queue; no enterprise execution or original DB writes."""
import asyncio,json,os,sys
from pathlib import Path
from dotenv import load_dotenv
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from neo_agent.job_queue import JobQueue
from neo_agent.engine import source_hash
from neo_agent.runner import run_once
from neo_agent.execution import SingleAttemptModel
from neo_agent.contracts import Job
load_dotenv('agent-service/.env')
async def main():
 out=Path('outputs/backend-closure/online');basis=json.loads((out/'frozen-basis.json').read_text());model=SingleAttemptModel(2000)
 if not model.key or not model.name:raise RuntimeError('正式模型未配置')
 basis['modelIdentity']=model.name
 q=JobQueue(out/'queue.sqlite');q.initialize();ident='online-operating-v1.3-'+basis['generationId']
 job=Job.model_validate({'id':ident,'businessId':'test-a','dataNature':'demo','snapshotId':basis['generationId'],'sessionId':'isolated-online','mode':'joint','purpose':'operating','question':'审查隔离合成数据','envelope':{'snapshot':{'id':basis['generationId'],'businessId':'test-a','dataNature':'demo','asOf':basis['asOf']},'operatingBasis':basis},'budget':{'maxModelCalls':8,'maxMarketSearches':0,'maxTokens':60000,'timeoutSeconds':600,'completionTokens':2000}}).model_dump(mode='json')
 q.submit(job,source_hash(job))
 async with AsyncSqliteSaver.from_conn_string(str(out/'checkpoints.sqlite')) as saver:await run_once(q,'online-validation',saver,model_factory=lambda:model)
 observation=q.observe(ident)
 text=json.dumps(observation,ensure_ascii=False,indent=2)
 (out/'observation.json').write_text(text);(out/(ident+'.json')).write_text(text)
 with q.db() as c:calls=[dict(r) for r in c.execute('SELECT state,model,usage,error FROM model_calls WHERE job_id=?',(ident,))]
 print(json.dumps({'status':observation['status'],'model':model.name,'calls':calls,'roles':list((observation.get('result') or {}).get('operatingReviews',{}))},ensure_ascii=False))
 if observation['status']!='completed':sys.exit(1)
asyncio.run(main())
