"""Execute one fenced job, preserving graph checkpoints and partial results."""
import asyncio
import json
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from .agent import AgentRuntime
from .operating_reviews import OperatingAgentRuntime
from .runtime import NeoRuntime
from .knowledge_monitor import KnowledgeRuntime
from .task_plan import plan_task
from .execution import JournaledModel, RunObserver, SingleAttemptModel, ExecutionError
from .providers import ProviderError
from .control_model import configure_control_model
from .engine import CalculationError, source_hash


def partial_result(values, job, model, error, code=None):
    details={'unfinishedAreas':values.get('runtimePlan',{}).get('unsupportedSteps') or ['完整综合判断或校验尚未完成'],'verifiedMetrics':values.get('calculationContext',{}),'scope':values.get('scope'),'runtimePlan':values.get('runtimePlan')} if values else {}
    if values and values.get('runtimePlan'):
        assessment=values.get('assessment')
        receipt=(assessment or {}).get('context',{}).get('semanticValidation',{})
        if receipt.get('status')=='verified' and receipt.get('version')=='semantic-support-v1':
            return {**values.get('draft',{}),**details,'businessAssessment':assessment,'semanticValidation':receipt,'partial':True}
        status='rejected' if code in ('CLAIM_NOT_SUPPORTED','CLAIM_VALIDATION_FAILED') else 'pending'
        return {**details,'finding':None,'specialists':{},'operatingReviews':{},'marketEvidence':values.get('evidence',[]),'usage':values.get('usage',[]),'toolReads':[r for r in values.get('toolReads',[]) if r.get('tool')!='read_specialists'],'partial':True,'semanticValidation':{'version':'semantic-support-v1','status':status,'errorCode':code},'notice':'正文尚未通过发布校验，仅保留内部检查点；已验证计算仍可回读'}
    if job.get('purpose')=='operating' and values and values.get('reviews'):
        return {**details,'operatingReviews':values['reviews'],'specialists':{},'marketEvidence':values.get('evidence',[]),'usage':values.get('usage',[]),'toolReads':values.get('toolReads',[]),'model':model,'partial':True,'snapshotId':job['snapshotId'],'generationId':job['snapshotId'],'dataNature':job['dataNature'],'notice':'联合研判未完成，专业检查点已保存'}
    findings = values.get('findings', {}) if values else {}
    if not findings:
        if values and values.get('calculationContext'):
            return {**details,'finding':None,'specialists':{},'marketEvidence':values.get('evidence',[]),'usage':values.get('usage',[]),'toolReads':values.get('toolReads',[]),'model':model,'partial':True,'snapshotId':job['snapshotId'],'businessId':job['businessId'],'dataNature':job['dataNature'],'notice':'经营计算结果已保存；专业推理及综合校验尚未完成'}
        return None
    first = dict(next(iter(findings.values())))
    first['gaps'] = first.get('gaps', []) + ['后续调查未完成：' + error[:500]]
    return {**details,'finding':first, 'specialists':findings, 'marketEvidence':values.get('evidence', []),
        'usage':values.get('usage', []), 'toolReads':values.get('toolReads', []),
        'model':model, 'partial':True, 'snapshotId':job['snapshotId'],
        'ontologyRef':job['envelope'].get('ontologyRef'), 'dataNature':job['dataNature']}


async def reconcile_recoveries(queue, saver):
    """Read crash-stranded results without restarting an uncertain request."""
    with queue.db() as c:
        rows=c.execute("SELECT * FROM jobs WHERE status='failed' AND lease_owner IS NULL AND result IS NULL AND error_code IN ('MODEL_CALL_UNCERTAIN','LEGACY_EXECUTION_UNCERTAIN','ATTEMPTS_EXHAUSTED')").fetchall()
    for row in rows:
        checkpoint=await saver.aget_tuple({'configurable':{'thread_id':row['id']}})
        values=checkpoint.checkpoint.get('channel_values',{}) if checkpoint else {}
        if not values.get('job') or source_hash(values['job']) != row['hash']:
            continue
        with queue.db() as c:
            model=c.execute('SELECT model FROM model_calls WHERE job_id=? ORDER BY started_at DESC LIMIT 1',(row['id'],)).fetchone()
        result=partial_result(values,json.loads(row['payload']),model['model'] if model else 'legacy-unverified',row['error'] or 'worker中断',row['error_code'])
        if result is not None:
            with queue.db(immediate=True) as c:
                c.execute("UPDATE jobs SET result=? WHERE id=? AND status='failed' AND result IS NULL AND lease_owner IS NULL",(json.dumps(result,ensure_ascii=False),row['id']))
                queue.event(c,row['id'],'checkpoint_result_restored',{})


async def preserve_repaired_draft(runtime,config,queue,ident,job,draft,cache=None):
    """Keep completed prose corrections internally; validation remains next."""
    saved=await runtime.graph.aget_state(config)
    if source_hash(saved.values.get('job'))!=source_hash(job):
        raise ExecutionError('修正检查点与任务范围不一致','EVIDENCE_SCOPE_MISMATCH')
    with queue.db() as c:
        if c.execute("SELECT 1 FROM model_calls WHERE job_id=? AND state IN ('started','uncertain')",(ident,)).fetchone():
            if not cache:return False
    if saved.next!=('validation',) or saved.values.get('assessment') or saved.values.get('result'):
        return False
    await runtime.graph.aupdate_state(config,{'draft':draft,**({'claimVerificationCache':cache} if cache else {})},as_node='synthesis')
    with queue.db(immediate=True) as c:
        queue.event(c,ident,'repaired_draft_checkpointed',{'draftHash':source_hash(draft),'semanticStatus':'unverified','next':'validation'})
    return True


async def run_once(queue, owner, saver, model_factory=None, market=None, poll_seconds=.1,lane=None):
    queue.recover()
    await reconcile_recoveries(queue,saver)
    row = queue.claim(owner,lane=lane)
    if not row:
        return False
    ident = row['id']
    job = json.loads(row['payload'])
    from .task_plan import unlimited_limits
    limits = unlimited_limits(json.loads(row['limits_json']))
    remaining_seconds = max(0,limits['timeoutSeconds']-row['run_seconds'])
    observer = RunObserver(queue,ident,owner)
    delegate = model_factory() if model_factory else SingleAttemptModel(limits['completionTokens'])
    model = JournaledModel(queue,ident,delegate,owner)
    # Old in-flight graph checkpoints keep their node names and original route.
    # Every fresh job (both input kinds) uses the shared graph.
    previous=await saver.aget_tuple({'configurable':{'thread_id':ident}})
    values=previous.checkpoint.get('channel_values',{}) if previous else {}
    legacy_checkpoint=bool(values.get('job') and not values.get('runtimePlan') and any(k in values for k in ('selected','findings','reviews','followupTargets','steps')))
    runtime_class = (OperatingAgentRuntime if job.get('purpose')=='operating' else AgentRuntime) if legacy_checkpoint else NeoRuntime
    if job.get('purpose')=='knowledge':runtime_class=KnowledgeRuntime
    if job.get('envelope',{}).get('scenarioRecommendationRef') or job.get('envelope',{}).get('scenarioRecommendationBasis'):
        from .scenario_options import ScenarioOptionsRuntime
        runtime_class=ScenarioOptionsRuntime
    model.reserve_semantic_slot = job.get('purpose')!='knowledge' and not legacy_checkpoint and plan_task(job)['taskType'] in ('QUERY','EXPLAIN')
    runtime = runtime_class(saver,model=model,market=market,progress=observer.progress,observer=observer)
    config = {'configurable':{'thread_id':ident},'recursion_limit':16}

    async def execute():
        saved = await runtime.graph.aget_state(config)
        # A crash after the graph committed but before the queue committed must
        # publish the saved result, never route from scratch and charge again.
        if saved.values.get('result') and not saved.next:
            return saved.values
        if remaining_seconds <= 0:
            raise ExecutionError('本任务累计运行时间已达到预算；检查点与调用记录已保留', 'RUN_TIMEOUT')
        if model_factory is None:
            await configure_control_model(delegate,job)
            model.name=delegate.name
        return await runtime.graph.ainvoke(None if saved.next else {'job':job}, config)

    task = asyncio.create_task(execute())
    state, error, code, retryable, result = 'completed', None, None, False, None
    elapsed = 0.0
    loop = asyncio.get_running_loop()
    started = loop.time()
    try:
        while not task.done():
            await asyncio.wait({task}, timeout=poll_seconds)
            elapsed = loop.time()-started
            alive = queue.heartbeat(ident,owner)
            if not alive:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                raise asyncio.CancelledError()
            if elapsed >= remaining_seconds and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                raise ExecutionError('本任务运行已达到时间预算，检查点与已完成结果已保留', 'RUN_TIMEOUT', True)
        outcome = await task
        result = outcome['result']
    except asyncio.CancelledError:
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        state, error, code = 'cancelled', '任务已中断，完成的专业结果和调用记录已保留', 'CANCELLED'
        if asyncio.current_task().cancelling():
            # Process shutdown: preserve lease recovery semantics, but first
            # release our task safely and persist its partial result.
            state, code, retryable = 'failed', 'WORKER_INTERRUPTED', True
    except Exception as e:
        state = 'failed'
        error = str(e)[:1000] if isinstance(e,(ProviderError,CalculationError,ValueError)) else '智能体运行失败，请检查日志；已保存检查点与调用记录'
        code = getattr(e,'code','CALCULATION_ERROR' if isinstance(e,CalculationError) else 'AGENT_FAILED')
        retryable = getattr(e,'retryable',False)
        if code in ('BACKGROUND_DAILY_BUDGET','MONITOR_DAILY_LIMIT'):state='deferred'
        if getattr(e,'recovery_draft',None):
            await preserve_repaired_draft(runtime,config,queue,ident,job,e.recovery_draft,getattr(e,'claim_cache',None))
    finally:
        if state != 'completed':
            saved = await runtime.graph.aget_state(config)
            result = partial_result(saved.values,job,model.name,error or '调查未完成',code)
            # An ambiguous provider request overrides a resumable timeout.
            with queue.db() as c:
                unknown = c.execute("SELECT 1 FROM model_calls WHERE job_id=? AND state IN ('started','uncertain')", (ident,)).fetchone()
            if unknown:
                code, retryable = 'MODEL_CALL_UNCERTAIN', False
                error = (error or '') + '；模型完成与计费状态未知，已阻止自动重发，请核对后另建任务'
        queue.finish(ident,owner,state,result,error,code,retryable)
    if asyncio.current_task().cancelling():
        raise asyncio.CancelledError()
    return True


async def run_worker(queue, owner, auto_enqueue=None,lane=None):
    async with AsyncSqliteSaver.from_conn_string(queue.path+'.checkpoints') as saver:
        while True:
            if auto_enqueue:
                auto_enqueue()
            if not await run_once(queue,owner,saver,lane=lane):
                await asyncio.sleep(.3)
