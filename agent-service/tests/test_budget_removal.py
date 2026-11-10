import asyncio,json
from neo_agent.execution import RunObserver,JournaledModel
from neo_agent.job_queue import JobQueue
from neo_agent.engine import source_hash
from test_queue_reliability import make_job,setup_queue,add


def test_tools_and_enabled_market_searches_have_no_count_admission_cap(tmp_path):
    async def run():
        q=setup_queue(tmp_path);j=make_job(budget={'maxToolCalls':1,'maxMarketSearches':1});add(q,j);q.claim('owner')
        observer=RunObserver(q,j['id'],'owner')
        for i in range(70):
            trace={'operationKey':str(i),'tool':'search_market' if i<5 else 'read_business'}
            await observer('tool_started',trace)
            await observer('tool_completed',{**trace,'toolResult':[]})
        obs=q.observe(j['id'])['observability']
        assert obs['toolCalls']==70 and obs['limits']['maxToolCalls'] is None and obs['limits']['maxMarketSearches'] is None
    asyncio.run(run())


def test_old_budget_failure_can_resume_explicitly_without_mutating_frozen_input(tmp_path):
    q=setup_queue(tmp_path);j=make_job(budget={'maxTokens':1});add(q,j);q.claim('owner')
    q.finish(j['id'],'owner','failed',code='TOKEN_BUDGET',error='旧预算失败')
    before=q.observe(j['id'])['observability']['inputHash']
    assert q.resume(j['id']) and q.observe(j['id'])['status']=='queued'
    assert q.observe(j['id'])['observability']['inputHash']==before
    with q.db() as c:assert json.loads(c.execute('SELECT payload FROM jobs').fetchone()[0])==j


def test_lifecycle_limits_still_apply_without_any_usage_caps(tmp_path):
    q=setup_queue(tmp_path);j=make_job(budget={'maxAttempts':2,'timeoutSeconds':10,'completionTokens':1});add(q,j)
    limits=q.observe(j['id'])['observability']['limits']
    assert limits['maxAttempts']==2 and limits['timeoutSeconds']==10
    assert limits['completionTokens'] is None
