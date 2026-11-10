import asyncio
import json
import pytest
from neo_agent.execution import reserve_input, input_profile, JournaledModel, ExecutionError
from test_queue_reliability import setup_queue, make_job, add


def test_reported_prefix_bounds_only_new_bytes_without_assuming_a_tokenizer():
    prefix=[{'role':'system','content':'模型指令'}, {'role':'tool','content':'已核验来源'*20000}]
    messages=prefix+[{'role':'tool','content':'新一轮经营汇总'*3000}]
    tools=[{'name':'read_business','description':'读取冻结快照'}]
    old=input_profile(prefix)
    full,_,_=reserve_input(messages,tools,[])
    count,profile,basis=reserve_input(messages,tools,[(old,{'prompt_tokens':42000})])
    assert basis['method']=='reported_prefix_plus_utf8_upper_bound'
    assert count==42000+profile[-1]['bytes']+8+len(json.dumps(tools,ensure_ascii=False).encode())+256
    assert count<full and input_profile(prefix)==old
    assert reserve_input(messages,tools,[(old,{'total_tokens':42000})])[0]==full
    assert reserve_input(messages,tools,[(old,{'prompt_tokens':0})])[0]==full
    changed=[{**prefix[0],'content':'不同指令'},*messages[1:]]
    assert reserve_input(changed,tools,[(old,{'prompt_tokens':42000})])[2]['method']=='utf8_upper_bound'


def test_chinese_multi_turn_usage_and_replay_continue_without_input_budget(tmp_path):
    class Model:
        name='BUDGET_TEST'
        calls=0
        async def call(self,messages,tools=None):
            self.calls+=1
            return {'role':'assistant','content':'已读取'},{'prompt_tokens':40000,'completion_tokens':100,'total_tokens':40100}
    async def run():
        q=setup_queue(tmp_path);j=make_job(budget={'maxTokens':256000});add(q,j);q.claim('owner')
        # Test the original journal accounting independently of the new task
        # class admission caps (covered by test_unified_runtime).
        with q.db() as c:
            limits=json.loads(c.execute('SELECT limits_json FROM jobs WHERE id=?',(j['id'],)).fetchone()[0]);limits.update(maxTokens=256000,completionTokens=6000)
            c.execute('UPDATE jobs SET limits_json=? WHERE id=?',(json.dumps(limits),j['id']))
        model=Model();journal=JournaledModel(q,j['id'],model,'owner')
        prefix=[{'role':'system','content':'只读经营资料'},{'role':'user','content':'来源摘要'*11000}]
        await journal.call(prefix)
        extended=prefix+[{'role':'assistant','content':'已读取'},{'role':'tool','content':'全部周汇总'*6000}]
        # The old bytes-for-tokens strategy rejects this despite actual usage.
        old_reserve=len(json.dumps({'messages':extended,'tools':None},ensure_ascii=False).encode())+256+6000
        assert old_reserve+40100>256000
        await journal.call(extended)
        assert model.calls==2
        # Replayed responses incur no new invocation or reservation.
        await journal.call(extended);assert model.calls==2
        await journal.call(extended+[{'role':'user','content':'过大输入'*100000}])
        assert model.calls==3
        with q.db() as c:
            starts=[json.loads(r['payload']) for r in c.execute("SELECT payload FROM run_events WHERE kind='model_started'")]
        assert starts[-1]['reservationBasis']['method']=='reported_prefix_plus_utf8_upper_bound'
    asyncio.run(run())


def test_unknown_reported_usage_remains_estimated_without_budget_rejection(tmp_path):
    class Model:
        name='NO_USAGE_TEST'
        async def call(self,messages,tools=None):return {'role':'assistant','content':'ok'},{}
    async def run():
        q=setup_queue(tmp_path);j=make_job(budget={'maxTokens':5000});add(q,j);q.claim('owner')
        journal=JournaledModel(q,j['id'],Model(),'owner')
        prefix=[{'role':'user','content':'x'*2000}]
        await journal.call(prefix)
        await journal.call(prefix+[{'role':'user','content':'more'}])
        observed=q.observe(j['id'])['observability']
        assert observed['modelInvocations']==2 and not observed['tokenCountIsComplete']
        assert observed['estimatedOrReservedTokens']>0
    asyncio.run(run())


@pytest.mark.parametrize('nature,purpose',[('demo','analysis'),('business','analysis'),('demo','patrol'),('business','knowledge')])
def test_unlimited_runtime_applies_without_acceptance_override(tmp_path,nature,purpose):
    class Model:
        name='UNLIMITED_TEST'
        calls=0
        async def call(self,messages,tools=None):
            self.calls+=1
            return {'role':'assistant','content':'ok'},{'total_tokens':300000}
    async def run():
        q=setup_queue(tmp_path);j=make_job(budget={'maxTokens':1,'maxModelCalls':1});j.update(dataNature=nature,purpose=purpose);add(q,j);q.claim('owner')
        model=Model();journal=JournaledModel(q,j['id'],model,'owner')
        huge=[{'role':'user','content':'完整上下文'*50000}]
        for i in range(4):await journal.call(huge+[{'role':'user','content':str(i)}])
        observed=q.observe(j['id'])['observability']
        assert model.calls==4 and observed['reportedTokens']==1200000
        assert observed['limits']['maxTokens'] is None and observed['limits']['maxModelCalls'] is None
        assert observed['budgetPolicy']=='unlimited'
    asyncio.run(run())
