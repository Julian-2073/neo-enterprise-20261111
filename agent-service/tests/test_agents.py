import asyncio,json
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from neo_agent.agent import AgentRuntime
from neo_agent.contracts import Job
from neo_agent.providers import Model,ProviderError,public_url
from test_engine import fixture

class MockModel:
    name='OFFLINE_TEST_ADAPTER'
    async def call(self,messages,tools=None):
        from semantic_model_stub import semantic_response
        checked=semantic_response(messages)
        if checked:return checked,{}
        if '为经营问题' in messages[0]['content']:return {'role':'assistant','content':'{"agents":["conversion"]}'},{}
        section='supply' if 'NEO 的供需纠察' in messages[0]['content'] else 'market' if 'NEO 的市场观察' in messages[0]['content'] else 'conversion'
        if messages[-1]['role']!='tool':return {'role':'assistant','content':None,'tool_calls':[{'id':'t0','type':'function','function':{'name':'describe_business','arguments':'{}'}},{'id':'t1','type':'function','function':{'name':'read_business','arguments':json.dumps({'section':section})}}]+([{'id':'decisions','type':'function','function':{'name':'read_decisions','arguments':'{}'}}] if 'NEO 的行动编排' in messages[0]['content'] else [])},{}
        return {'role':'assistant','content':json.dumps({'conclusion':'已读取经营证据；不能把行为次数称为人数。','evidenceIds':['ev1'],'alternatives':['供给因素仍需核查'],'gaps':['没有客户关联'],'candidates':['核实库存'],'followups':[]})},{}

@pytest.mark.parametrize('mode',['conversion','supply','market','joint','orchestrator'])
def test_all_modes_use_tools_and_checkpoint(tmp_path,mode):
    async def run():
        job={'id':'test-'+mode,'businessId':'b1','dataNature':'demo','snapshotId':'snap1','sessionId':'s','mode':mode,'question':'调查经营','envelope':fixture()}
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'cp.sqlite')) as saver:
            r=AgentRuntime(saver,model=MockModel());config={'configurable':{'thread_id':job['id']}}
            out=await r.graph.ainvoke({'job':job},config)
            assert out['result']['finding']['evidenceIds']==['ev1'];assert (await r.graph.aget_state(config)).values['result']
    asyncio.run(run())

def test_missing_credentials_explicit(monkeypatch):
    monkeypatch.delenv('LLM_API_KEY',raising=False);monkeypatch.delenv('LLM_MODEL',raising=False)
    with pytest.raises(ProviderError,match='模型未配置'):asyncio.run(Model().call([]))

def test_private_urls_rejected():
    for url in ['file:///etc/passwd','http://127.0.0.1:80/','http://user:password@example.com','http://[::1]/']:
        with pytest.raises(ProviderError):asyncio.run(public_url(url))

def test_job_scope_mismatch():
    with pytest.raises(ValueError):Job(id='x',businessId='other',dataNature='demo',snapshotId='snap1',sessionId='s',mode='joint',question='q',envelope=fixture())

def test_manual_specialist_does_not_expand_scope_from_model_followup_suggestions(tmp_path):
    class SuggestedModel(MockModel):
        async def call(self,messages,tools=None):
            msg,usage=await super().call(messages,tools)
            if msg.get('content') and 'conclusion' in msg['content']:
                finding=json.loads(msg['content']);finding['followups']=['supply','market'];msg['content']=json.dumps(finding)
            return msg,usage
    async def run():
        job={'id':'manual-scope','businessId':'b1','dataNature':'demo','snapshotId':'snap1','sessionId':'s','mode':'conversion','purpose':'analysis','question':'只核对支付订单','envelope':fixture(),'budget':{'maxMarketSearches':0}}
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'cp.sqlite')) as saver:
            out=await AgentRuntime(saver,model=SuggestedModel()).graph.ainvoke({'job':job},{'configurable':{'thread_id':job['id']}})
            assert list(out['result']['specialists'])==['conversion']
            assert out['completedFollowups']==[]
            assert out['result']['finding']['evidenceIds']==['ev1']
    asyncio.run(run())

def test_manual_fact_question_excludes_unrequested_calculations(tmp_path):
    class ReadModel(MockModel):
        async def call(self,messages,tools=None):
            assert not {'forecast','simulate_scenario'} & {t['function']['name'] for t in tools or []}
            return await super().call(messages,tools)
    async def run():
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'cp.sqlite')) as saver:
            j={'id':'facts-only','businessId':'b1','dataNature':'demo','snapshotId':'snap1','sessionId':'s','mode':'market','purpose':'analysis','question':'只比较渠道费用和成交，不做预测。','envelope':fixture(),'budget':{'maxMarketSearches':0}}
            out=await AgentRuntime(saver,model=ReadModel()).graph.ainvoke({'job':j},{'configurable':{'thread_id':j['id']}})
            assert out['result']['finding']['evidenceIds']==['ev1']
    asyncio.run(run())
