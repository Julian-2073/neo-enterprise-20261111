import asyncio
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone, timedelta
import json
import sqlite3
import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from neo_agent.agent import AgentRuntime
from neo_agent.contracts import Job
from neo_agent.engine import source_hash
from neo_agent.execution import JournaledModel, RunObserver, ModelRejected, SingleAttemptModel, ExecutionError
from neo_agent.job_queue import JobQueue, QueueConflict, stamp
from neo_agent.runner import run_once, partial_result
from neo_agent.patrol import register_watch, enqueue_due
from test_agents import MockModel
from test_presentation import OrganizedModel
from test_engine import fixture


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.setenv('NEO_AUTO_PATROL','false')
    monkeypatch.delenv('LLM_API_KEY',raising=False)
    monkeypatch.delenv('TAVILY_API_KEY',raising=False)
    monkeypatch.delenv('NEO_FIRECRAWL_MCP_COMMAND',raising=False)


def make_job(ident='sim-run', **overrides):
    env=fixture()
    env['snapshot'].update(businessId='neo-sim-acceptance-20261004',businessName='NEO 隔离模拟企业',id='sim-snapshot-v1')
    for r in env['facts']:
        r['id']='sim-'+r['id']
        for key in ('product_id','sku_id','order_id','order_line_id','contact_id','warehouse_id'):
            if r['fact'].get(key):r['fact'][key]='sim-'+r['fact'][key]
    for r in env['snapshot'].get('data',{}).get('inventory',[]):
        for key in ('product_id','sku_id','warehouse_id'):
            if r.get(key):r[key]='sim-'+r[key]
    data=dict(id=ident,businessId=env['snapshot']['businessId'],dataNature='demo',snapshotId='sim-snapshot-v1',sessionId='sim-session',mode='conversion',purpose='analysis',question='检查固定经营数据',envelope=env)
    data.update(overrides)
    j=Job.model_validate(data).model_dump(mode='json')
    if j.get('budget') is None:j.pop('budget',None)
    return j


def setup_queue(tmp_path):
    q=JobQueue(tmp_path/'jobs.sqlite');q.initialize();return q


def add(q,j):
    return q.submit(j,source_hash(j))


class Counter(MockModel):
    def __init__(self):self.calls=0
    async def call(self,messages,tools=None):
        self.calls+=1
        message,_=await super().call(messages,tools)
        return message,{'prompt_tokens':10,'completion_tokens':5,'total_tokens':15}


def test_migration_preserves_rows_hash_checkpoint_and_old_patrol_insert(tmp_path):
    path=tmp_path/'jobs.sqlite'
    with sqlite3.connect(path) as c:
        c.execute('CREATE TABLE jobs(id TEXT PRIMARY KEY,hash TEXT,payload TEXT,status TEXT,steps TEXT,result TEXT,error TEXT,created_at TEXT,updated_at TEXT)')
        j=make_job();c.execute("INSERT INTO jobs VALUES(?,?,?,'failed','[]',?,'old error',?,?)",(j['id'],source_hash(j),json.dumps(j),'{}',stamp(),stamp()))
    q=JobQueue(path);q.initialize();q.initialize()
    assert q.observe(j['id'])['status']=='failed'
    assert q.observe(j['id'])['observability']['inputHash']==source_hash(j)
    assert add(q,j) is False


def test_interactive_before_patrol_fifo_within_class_no_parallel_claim(tmp_path):
    q=setup_queue(tmp_path)
    add(q,make_job('sim-patrol',mode='joint',purpose='patrol'))
    add(q,make_job('sim-question-1'));add(q,make_job('sim-question-2'))
    assert q.observe('sim-question-1')['observability']['queuePosition']==1
    r=q.claim('sim-owner');assert r['id']=='sim-question-1'
    assert q.claim('another-owner') is None
    q.finish(r['id'],'sim-owner','completed',{'marketEvidence':[]})
    assert q.claim('sim-owner')['id']=='sim-question-2'
    assert q.observe('sim-patrol')['observability']['priorityClass']=='scheduled_patrol'


def test_transaction_claim_has_exactly_one_owner_across_connections(tmp_path):
    q=setup_queue(tmp_path);add(q,make_job('sim-one'));add(q,make_job('sim-two'))
    with ThreadPoolExecutor(max_workers=4) as pool:
        claimed=list(pool.map(lambda i:q.claim('owner-'+str(i)),range(4)))
    assert len([x for x in claimed if x])==1


def test_immutable_duplicate_dispatch_id_conflict_and_cancelling_queued(tmp_path):
    q=setup_queue(tmp_path);j=make_job();assert add(q,j)
    assert not add(q,j)
    changed=deepcopy(j);changed['question']='新的问题'
    with pytest.raises(QueueConflict,match='内容不同'):add(q,changed)
    q.cancel(j['id']);q.cancel(j['id']);assert q.observe(j['id'])['status']=='cancelled'
    assert q.resume(j['id']) is True and q.resume(j['id']) is False
    assert q.observe(j['id'])['observability']['attemptCount']==0


def test_fenced_finish_cannot_overwrite_cancelled_or_new_owner(tmp_path):
    q=setup_queue(tmp_path);j=make_job();add(q,j);q.claim('old')
    q.cancel(j['id'])
    with pytest.raises(QueueConflict,match='收尾'):q.resume(j['id'])
    assert not q.finish(j['id'],'wrong','completed',{})
    assert q.finish(j['id'],'old','completed',{'marketEvidence':[]})
    assert q.observe(j['id'])['status']=='cancelled'
    q.resume(j['id']);q.claim('new')
    assert q.resume(j['id']) is False
    assert not q.finish(j['id'],'old','failed',{},'stale')
    q.finish(j['id'],'new','completed',{})
    assert q.resume(j['id']) is False


def test_stale_worker_recovery_is_idempotent_and_attempt_bound(tmp_path):
    q=setup_queue(tmp_path);j=make_job(budget={'maxAttempts':1});add(q,j);q.claim('sim-owner')
    with q.db() as c:c.execute("UPDATE jobs SET lease_expires_at='2000-01-01T00:00:00+00:00'")
    assert q.recover()==1 and q.recover()==0
    assert q.observe(j['id'])['observability']['errorCode']=='ATTEMPTS_EXHAUSTED'
    with pytest.raises(QueueConflict,match='尝试上限'):q.resume(j['id'])


def test_recovery_marks_inflight_model_unknown_and_does_not_dispatch(tmp_path):
    q=setup_queue(tmp_path);j=make_job();add(q,j);q.claim('sim-owner')
    with q.db() as c:
        c.execute("UPDATE jobs SET lease_expires_at='2000-01-01T00:00:00+00:00'")
        c.execute("INSERT INTO model_calls VALUES(?,?,'started','offline',NULL,NULL,NULL,100,?,NULL)",(j['id'],'sim-call',stamp()))
    q.recover();r=q.observe(j['id'])
    assert r['status']=='failed' and r['observability']['modelCallsUncertain']==1
    assert q.claim('new') is None
    with pytest.raises(QueueConflict,match='计费状态未知'):q.resume(j['id'])


def test_cancelled_expired_worker_releases_lease_without_guessing_model_billing(tmp_path):
    q=setup_queue(tmp_path);j=make_job();add(q,j);q.claim('sim-owner');q.cancel(j['id'])
    with q.db() as c:c.execute("UPDATE jobs SET lease_expires_at='2000-01-01T00:00:00+00:00'")
    q.recover();assert q.resume(j['id'])


def test_legacy_running_without_call_journal_requires_readback_not_auto_replay(tmp_path):
    q=setup_queue(tmp_path);j=make_job();add(q,j)
    with q.db() as c:c.execute("UPDATE jobs SET status='running'")
    q.recover()
    assert q.observe(j['id'])['observability']['errorCode']=='LEGACY_EXECUTION_UNCERTAIN'
    with pytest.raises(QueueConflict,match='升级前'):q.resume(j['id'])


def test_worker_real_graph_completes_and_observes_route_usage_tools(tmp_path):
    async def run():
        q=setup_queue(tmp_path);j=make_job();add(q,j);model=Counter()
        async with AsyncSqliteSaver.from_conn_string(q.path+'.checkpoints') as saver:
            assert await run_once(q,'sim-owner',saver,model_factory=lambda:model,poll_seconds=.005)
        r=q.observe(j['id']);obs=r['observability']
        assert r['status']=='completed'
        assert obs['attemptCount']==1 and obs['waitSeconds']>=0 and obs['runSeconds']>0
        assert obs['modelCallsCompleted']==model.calls==2
        assert obs['reportedTokens']==30 and obs['toolFailures']==[]
        assert len(r['result']['usage'])==2  # deterministic task planning spends no model call
        assert any(t['tool']=='read_business' and t['queryEvidence']['snapshotId']==j['snapshotId'] for t in r['result']['toolReads'])
        assert r['result']['runtime']['inputHash']==source_hash(j)
    asyncio.run(run())


def test_node_replay_reuses_planned_tool_reads_and_known_rejection_is_bounded(tmp_path):
    class OnceRejected(Counter):
        def __init__(self):super().__init__();self.rejected=False
        async def call(self,messages,tools=None):
            if messages[-1]['role']=='tool' and not self.rejected:
                self.calls+=1;self.rejected=True;raise ModelRejected('模拟额度拒绝')
            return await super().call(messages,tools)
    async def run():
        q=setup_queue(tmp_path);j=make_job(question='支付订单多少');add(q,j);model=OnceRejected()
        async with AsyncSqliteSaver.from_conn_string(q.path+'.checkpoints') as saver:
            await run_once(q,'sim-owner',saver,model_factory=lambda:model,poll_seconds=.005)
            r=q.observe(j['id']);assert r['status']=='failed' and r['observability']['retryable']
            assert r['observability']['modelCallsCompleted']==0
            q.resume(j['id']);q.resume(j['id'])
            await run_once(q,'sim-owner',saver,model_factory=lambda:model,poll_seconds=.005)
        r=q.observe(j['id']);assert r['status']=='completed',r
        assert model.calls==3 and r['observability']['modelReplays']==0
        assert r['result']['businessAssessment']['context']['semanticValidation']['status']=='verified'
        assert r['observability']['attemptCount']==2
        assert r['observability']['reportedTokens']==30
    asyncio.run(run())


def test_failed_next_specialist_keeps_previous_result_usage_and_resumes_checkpoint(tmp_path):
    class OnceSupplyRejected(OrganizedModel):
        def __init__(self):self.rejected=False;self.conversion_calls=0
        async def call(self,messages,tools=None):
            from semantic_model_stub import semantic_response
            checked=semantic_response(messages)
            if checked:return checked,{'total_tokens':7}
            if 'NEO 的转化纠察' in messages[0]['content']:self.conversion_calls+=1
            if 'NEO 的供需纠察' in messages[0]['content'] and not self.rejected:
                self.rejected=True;raise ModelRejected('模拟供需服务不可用')
            msg,_=await super().call(messages,tools)
            return msg,{'total_tokens':7}
    async def run():
        q=setup_queue(tmp_path);j=make_job(mode='joint',purpose='patrol');add(q,j);model=OnceSupplyRejected()
        async with AsyncSqliteSaver.from_conn_string(q.path+'.checkpoints') as saver:
            await run_once(q,'sim-owner',saver,model_factory=lambda:model,poll_seconds=.005)
            failed=q.observe(j['id'])
            assert failed['status']=='failed' and failed['result']['partial']
            assert failed['result']['specialists']=={} and failed['result']['semanticValidation']['status']=='pending'
            assert failed['result']['usage'] and failed['result']['toolReads']
            q.resume(j['id'])
            await run_once(q,'sim-owner',saver,model_factory=lambda:model,poll_seconds=.005)
        # Planned reads avoid duplicate model routing; retry and semantic gate still share the cap.
        r=q.observe(j['id']);assert r['status']=='completed'
        assert r['observability']['modelInvocations']<=8
        assert set(r['result']['specialists'])=={'conversion','supply','market'}
        assert model.conversion_calls==1
    asyncio.run(run())


def test_saved_graph_result_recovered_after_queue_commit_crash_has_no_new_model_calls(tmp_path):
    async def run():
        q=setup_queue(tmp_path);j=make_job();add(q,j);q.claim('old');model=Counter()
        async with AsyncSqliteSaver.from_conn_string(q.path+'.checkpoints') as saver:
            obs=RunObserver(q,j['id']);runtime=AgentRuntime(saver,model=JournaledModel(q,j['id'],model),progress=obs.progress,observer=obs)
            await runtime.graph.ainvoke({'job':j},{'configurable':{'thread_id':j['id']}})
            with q.db() as c:c.execute("UPDATE jobs SET lease_expires_at='2000-01-01T00:00:00+00:00'")
            await run_once(q,'new',saver,model_factory=lambda:model,poll_seconds=.005)
        assert q.observe(j['id'])['status']=='completed' and model.calls==3
    asyncio.run(run())


def test_cancellation_between_nodes_resumes_without_repeating_completed_analysis(tmp_path):
    async def run():
        q=setup_queue(tmp_path);j=make_job();add(q,j);q.claim('old');model=Counter()
        async with AsyncSqliteSaver.from_conn_string(q.path+'.checkpoints') as saver:
            obs=RunObserver(q,j['id']);runtime=AgentRuntime(saver,model=JournaledModel(q,j['id'],model),progress=obs.progress,observer=obs)
            await runtime.graph.ainvoke({'job':j},{'configurable':{'thread_id':j['id']}},interrupt_before=['synthesize'])
            saved=await runtime.graph.aget_state({'configurable':{'thread_id':j['id']}})
            assert saved.next==('synthesize',)
            q.cancel(j['id']);q.finish(j['id'],'old','cancelled',partial_result(saved.values,j,model.name,'取消'))
            assert q.observe(j['id'])['result']['partial']
            q.resume(j['id'])
            await run_once(q,'new',saver,model_factory=lambda:model,poll_seconds=.005)
        assert q.observe(j['id'])['status']=='completed' and model.calls==3
    asyncio.run(run())


def test_inflight_cancel_interrupts_and_blocks_uncertain_model_replay(tmp_path):
    class Hanging(Counter):
        def __init__(self):super().__init__();self.started=asyncio.Event()
        async def call(self,messages,tools=None):
            self.started.set();await asyncio.Event().wait()
    async def run():
        q=setup_queue(tmp_path);j=make_job();add(q,j);model=Hanging()
        async with AsyncSqliteSaver.from_conn_string(q.path+'.checkpoints') as saver:
            worker=asyncio.create_task(run_once(q,'sim-owner',saver,model_factory=lambda:model,poll_seconds=.005))
            await asyncio.wait_for(model.started.wait(),2)
            q.cancel(j['id']);await asyncio.wait_for(worker,2)
        r=q.observe(j['id']);assert r['status']=='cancelled'
        assert r['observability']['errorCode']=='MODEL_CALL_UNCERTAIN'
        with pytest.raises(QueueConflict,match='计费状态未知'):q.resume(j['id'])
    asyncio.run(run())


@pytest.mark.parametrize('budget,code',[
    ({'maxTokens':1},'TOKEN_BUDGET'),({'maxModelCalls':1},'MODEL_CALL_BUDGET'),({'maxToolCalls':1},'TOOL_BUDGET'),
])
def test_legacy_budget_does_not_stop_complete_work_and_preserves_usage(tmp_path,budget,code):
    async def run():
        q=setup_queue(tmp_path);j=make_job(budget=budget);add(q,j);model=Counter()
        async with AsyncSqliteSaver.from_conn_string(q.path+'.checkpoints') as saver:
            await run_once(q,'sim-owner',saver,model_factory=lambda:model,poll_seconds=.005)
        r=q.observe(j['id']);assert r['status']=='completed',r
        assert r['observability']['errorCode'] is None
        assert r['observability']['reportedTokens']==model.calls*15 and model.calls>1
    asyncio.run(run())


def test_timeout_retains_uncertain_ledger_and_worker_shutdown_settles(tmp_path):
    class Hanging(Counter):
        started=False
        async def call(self,messages,tools=None):
            self.started=True
            await asyncio.Event().wait()
    async def run():
        # Leave time for graph/checkpoint startup; this case tests a call that
        # has actually started, rather than assuming it starts within 20 ms.
        q=setup_queue(tmp_path);j=make_job(budget={'timeoutSeconds':2});add(q,j);model=Hanging()
        async with AsyncSqliteSaver.from_conn_string(q.path+'.checkpoints') as saver:
            await run_once(q,'sim-owner',saver,model_factory=lambda:model,poll_seconds=.005)
        assert model.started
        r=q.observe(j['id']);assert r['status']=='failed' and r['observability']['modelCallsUncertain']==1
        assert '时间预算' in r['error'] and not r['observability']['retryable']
    asyncio.run(run())


def test_tool_failures_persist_even_if_specialist_does_not_checkpoint(tmp_path):
    class InvalidRead(Counter):
        async def call(self,messages,tools=None):
            self.calls+=1
            if '为经营问题' in messages[0]['content']:return {'role':'assistant','content':'{"agents":["conversion"]}'},{'total_tokens':1}
            return {'role':'assistant','tool_calls':[{'id':'bad','function':{'name':'read_business','arguments':'{"section":"conversion","periodStart":"1900-01-01"}'}}]},{'total_tokens':1}
    async def run():
        q=setup_queue(tmp_path);j=make_job();add(q,j)
        async with AsyncSqliteSaver.from_conn_string(q.path+'.checkpoints') as saver:
            await run_once(q,'sim-owner',saver,model_factory=InvalidRead,poll_seconds=.005)
        r=q.observe(j['id']);assert r['status']=='failed'
        assert r['observability']['toolFailures']
        assert any('授权冻结' in x['error'] for x in r['observability']['toolFailures'])
    asyncio.run(run())


def test_model_version_change_never_silently_reissues_saved_request(tmp_path):
    async def run():
        q=setup_queue(tmp_path);j=make_job();add(q,j);q.claim('sim-owner');model=Counter()
        await JournaledModel(q,j['id'],model).call([{'role':'user','content':'q'}])
        model.name='CHANGED_ADAPTER'
        with pytest.raises(ExecutionError,match='模型版本已改变'):await JournaledModel(q,j['id'],model).call([{'role':'user','content':'q'}])
        assert model.calls==1
    asyncio.run(run())


def test_daily_patrol_immutable_versions_and_priority(tmp_path):
    q=setup_queue(tmp_path);j=make_job(mode='joint',purpose='patrol',autoRepeat=True)
    with q.db(immediate=True) as c:
        register_watch(c,Job.model_validate(j),'2026-10-04')
        c.execute("UPDATE patrol_watches SET last_day='2026-10-03'")
        moment=datetime(2026,10,3,17,tzinfo=timezone.utc)
        enqueue_due(c,'2026-10-04T00:00:00+00:00',moment);enqueue_due(c,'2026-10-04T00:00:00+00:00',moment)
    with q.db() as c:rows=c.execute('SELECT * FROM jobs').fetchall()
    assert len(rows)==1 and rows[0]['priority']==0 and rows[0]['limits_json']
    before=json.loads(rows[0]['payload']);assert before['snapshotId']==j['snapshotId']
    newer=deepcopy(j);newer['snapshotId']='sim-snapshot-v2';newer['envelope']['snapshot']['id']=newer['snapshotId']
    with q.db(immediate=True) as c:register_watch(c,Job.model_validate(newer),'2026-10-05')
    with q.db() as c:assert json.loads(c.execute('SELECT payload FROM jobs').fetchone()[0])==before


def test_http_dispatch_replay_cancel_resume_and_conflict_without_starting_worker(tmp_path,monkeypatch):
    from neo_agent import app as service
    q=setup_queue(tmp_path)
    monkeypatch.setattr(service,'DB',q.path)
    monkeypatch.setenv('NEO_SERVICE_TOKEN','offline-test-service-token-at-least-32-characters')
    # No lifespan context, hence no automatic worker, no ports or providers.
    client=TestClient(service.app)
    headers={'Authorization':'Bearer offline-test-service-token-at-least-32-characters'}
    j=make_job()
    assert client.post('/runs',json=j,headers=headers).status_code==200
    assert client.post('/runs',json=j,headers=headers).json()['observability']['attemptCount']==0
    bad={**j,'question':'不同任务'}
    assert client.post('/runs',json=bad,headers=headers).status_code==409
    assert client.post('/runs/'+j['id']+'/cancel',headers=headers).json()['status']=='cancelled'
    assert client.post('/runs/'+j['id']+'/resume',headers=headers).json()['status']=='queued'
    assert client.post('/runs/'+j['id']+'/resume',headers=headers).status_code==200
    assert client.get('/queue',headers=headers).json()['scheduler'].startswith('single-worker')
    assert client.get('/runs/'+j['id']).status_code==401


def test_missing_provider_usage_is_reserved_estimate_not_reported_usage(tmp_path):
    async def run():
        q=setup_queue(tmp_path);j=make_job();add(q,j);q.claim('sim-owner')
        await JournaledModel(q,j['id'],MockModel()).call([{'role':'user','content':'检查范围'}])
        obs=q.observe(j['id'])['observability']
        assert obs['reportedTokens']==0 and obs['estimatedOrReservedTokens']>0
        assert not obs['tokenCountIsComplete']
    asyncio.run(run())


def test_fenced_old_runtime_cannot_dispatch_after_lease_reassigned(tmp_path):
    async def run():
        q=setup_queue(tmp_path);j=make_job();add(q,j);q.claim('old')
        model=Counter();journal=JournaledModel(q,j['id'],model);observer=RunObserver(q,j['id'])
        with q.db() as c:c.execute("UPDATE jobs SET lease_owner='new'")
        with pytest.raises(asyncio.CancelledError):await journal.call([{'role':'user','content':'q'}])
        with pytest.raises(asyncio.CancelledError):await observer.progress(j['id'],'旧任务不再推进')
        assert model.calls==0
    asyncio.run(run())


@pytest.mark.parametrize('status',[402,429,503,408])
def test_production_model_adapter_makes_one_http_attempt_only(monkeypatch,status):
    import httpx
    from neo_agent import execution
    monkeypatch.setenv('LLM_API_KEY','offline-fake-not-a-credential')
    monkeypatch.setenv('LLM_MODEL','OFFLINE_TEST_ADAPTER')
    monkeypatch.setenv('LLM_BASE_URL','https://offline.invalid/v1')
    requests=[]
    def respond(request):
        requests.append(request)
        return httpx.Response(status,json={'error':'offline rejection'})
    original=httpx.AsyncClient
    monkeypatch.setattr(execution.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(respond),**kwargs))
    error=ModelRejected if status in (402,429) else ExecutionError
    with pytest.raises(error):asyncio.run(SingleAttemptModel().call([{'role':'user','content':'q'}]))
    assert len(requests)==1


def test_market_tool_completed_result_replays_without_second_external_search(tmp_path):
    async def run():
        q=setup_queue(tmp_path);j=make_job();add(q,j);q.claim('sim-owner')
        observer=RunObserver(q,j['id'])
        trace={'operationKey':'sim-market-op','tool':'search_market','argumentsRaw':'{"query":"模拟"}'}
        assert await observer('tool_started',trace) is None
        result=[{'id':'sim-market-source','verificationStatus':'unavailable','title':'虚构测试市场事件'}]
        await observer('tool_completed',{**trace,'toolResult':result})
        assert await observer('tool_started',trace)==result
        assert q.observe(j['id'])['observability']['toolCalls']==1
    asyncio.run(run())


def test_market_replay_unknown_and_market_budget_zero_stop_before_network(tmp_path):
    async def run():
        q=setup_queue(tmp_path);j=make_job(budget={'maxMarketSearches':0});add(q,j);q.claim('sim-owner')
        observer=RunObserver(q,j['id'])
        trace={'operationKey':'sim-market-op','tool':'search_market','argumentsRaw':'{}'}
        with pytest.raises(ExecutionError,match='未启用市场检索'):await observer('tool_started',trace)
        assert q.observe(j['id'])['observability']['toolCalls']==0
        with q.db() as c:
            c.execute('UPDATE jobs SET limits_json=?',(json.dumps({'maxToolCalls':64,'maxMarketSearches':2}),))
        await observer('tool_started',trace)
        with pytest.raises(ExecutionError,match='重复额度消耗'):await observer('tool_started',trace)
    asyncio.run(run())


def test_worker_shutdown_preserves_partial_and_uncertain_call(tmp_path):
    class Hanging(Counter):
        def __init__(self):super().__init__();self.started=asyncio.Event()
        async def call(self,messages,tools=None):self.started.set();await asyncio.Event().wait()
    async def run():
        q=setup_queue(tmp_path);j=make_job();add(q,j);model=Hanging()
        async with AsyncSqliteSaver.from_conn_string(q.path+'.checkpoints') as saver:
            task=asyncio.create_task(run_once(q,'sim-owner',saver,model_factory=lambda:model,poll_seconds=.005))
            await asyncio.wait_for(model.started.wait(),2);task.cancel()
            with pytest.raises(asyncio.CancelledError):await task
        assert q.observe(j['id'])['status']=='failed'
        with q.db() as c:assert c.execute('SELECT lease_owner FROM jobs').fetchone()[0] is None
        assert q.observe(j['id'])['observability']['modelCallsUncertain']==1
    asyncio.run(run())


def test_crash_recovery_reads_partial_checkpoint_without_reissuing_unknown_call(tmp_path):
    async def run():
        q=setup_queue(tmp_path);j=make_job(mode='joint');add(q,j);q.claim('old');model=Counter()
        config={'configurable':{'thread_id':j['id']}}
        async with AsyncSqliteSaver.from_conn_string(q.path+'.checkpoints') as saver:
            observer=RunObserver(q,j['id'])
            runtime=AgentRuntime(saver,model=JournaledModel(q,j['id'],model),progress=observer.progress,observer=observer)
            await runtime.graph.ainvoke({'job':j},config,interrupt_after=['investigate'])
            saved=await runtime.graph.aget_state(config)
            assert list(saved.values['findings'])==['conversion']
            with q.db() as c:
                c.execute("UPDATE jobs SET lease_expires_at='2000-01-01T00:00:00+00:00'")
                c.execute("INSERT INTO model_calls VALUES(?,?,'started',?,NULL,NULL,NULL,100,?,NULL)",(j['id'],'sim-lost-response',model.name,stamp()))
            assert not await run_once(q,'new',saver,model_factory=lambda:model,poll_seconds=.005)
        r=q.observe(j['id'])
        assert r['status']=='failed' and r['result']['partial']
        assert list(r['result']['specialists'])==['conversion']  # historical legacy graph remains separately unverified
        assert model.calls==2  # joint route is deterministic
        assert r['observability']['modelCallsUncertain']==1
    asyncio.run(run())


def test_cumulative_runtime_budget_applies_across_resume_attempts(tmp_path):
    async def run():
        q=setup_queue(tmp_path);j=make_job(budget={'timeoutSeconds':.02});add(q,j);q.claim('old')
        q.finish(j['id'],'old','failed',error='可控测试中断')
        with q.db() as c:c.execute('UPDATE jobs SET run_seconds=1')
        q.resume(j['id']);model=Counter()
        async with AsyncSqliteSaver.from_conn_string(q.path+'.checkpoints') as saver:
            await run_once(q,'new',saver,model_factory=lambda:model,poll_seconds=.005)
        assert model.calls==0
        assert q.observe(j['id'])['observability']['errorCode']=='RUN_TIMEOUT'
    asyncio.run(run())


def test_reserved_interactive_lane_does_not_wait_for_background_and_fences_duplicates(tmp_path):
    q=setup_queue(tmp_path)
    add(q,make_job('background',purpose='patrol',mode='joint'))
    add(q,make_job('interactive'))
    background=q.claim('background-worker',lane='background')
    assert background['id']=='background'
    interactive=q.claim('interactive-worker',lane='interactive')
    assert interactive['id']=='interactive'
    assert q.claim('another-background',lane='background') is None
    assert q.claim('another-interactive',lane='interactive') is None
    assert q.claim('legacy-worker') is None
    assert q.heartbeat('background','interactive-worker') is False
    assert q.finish('background','interactive-worker','completed') is False
    assert q.finish('background','background-worker','completed')
    assert q.finish('interactive','interactive-worker','completed')


def test_queue_rotates_equal_priority_enterprises_without_breaking_job_order(tmp_path):
    q=setup_queue(tmp_path)
    for ident,business in [('a-first','tenant-a'),('a-second','tenant-a'),('b-first','tenant-b')]:
        j=make_job(ident)
        j['businessId']=business
        j['envelope']['snapshot']['businessId']=business
        add(q,j)
    first=q.claim('one',lane='interactive');assert first['id']=='a-first'
    assert q.finish(first['id'],'one','completed')
    second=q.claim('two',lane='interactive');assert second['id']=='b-first'
    assert q.finish(second['id'],'two','completed')
    assert q.claim('three',lane='interactive')['id']=='a-second'


def test_legacy_claim_fences_reserved_lanes_and_expired_lane_recovers(tmp_path):
    q=setup_queue(tmp_path)
    add(q,make_job('legacy'))
    add(q,make_job('review',purpose='review'))
    assert q.claim('legacy-owner')['id']=='legacy'
    assert q.claim('background-owner',lane='background') is None
    with q.db(immediate=True) as c:
        c.execute("UPDATE jobs SET lease_expires_at='2000-01-01T00:00:00+00:00' WHERE id='legacy'")
    q.recover()
    assert q.claim('replacement',lane='interactive')['id']=='legacy'
    assert q.claim('background-owner',lane='background')['id']=='review'
