import asyncio,json,sqlite3
from datetime import datetime,timezone
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from pydantic import ValidationError
from neo_agent.contracts import Finding,Job
from neo_agent.agent import AgentRuntime
from neo_agent.business_tools import describe_business,validate_organization,read_fact_view
from neo_agent.patrol import enqueue_due,register_watch
from test_engine import fixture
from test_agents import MockModel

def finding(**overrides):
    data=dict(conclusion='先核查供给，再比较预算；当前没有因果依据。',evidenceIds=['ev1'],alternatives=[],gaps=['无客户关联'],candidates=[]);data.update(overrides);return Finding(**data)

def test_short_reply_keeps_limits_in_details():
    assert finding().gaps==['无客户关联']
    with pytest.raises(ValidationError):finding(conclusion='长'*181)

def test_business_map_and_scoped_fact_view_never_imply_customer_linkage():
    env=fixture();env['facts']=[{'kind':'orders','id':'a','fact':{'product_id':'p1','channel':'c1','business_date':'2026-07-06'}},{'kind':'orders','id':'b','fact':{'product_id':'p2','channel':'c2','business_date':'2026-07-06'}}]
    result=describe_business(env)
    assert result['units']['events']=='行为次数'
    assert read_fact_view(env,'conversion',{'productId':'p1'})['factCount']==1
    assert read_fact_view(env,'conversion',{'channel':'c2'})['facts'][0]['id']=='b'

def test_organization_rejects_invented_choices_and_evidence():
    report={'headline':'先查供给','summary':'目前只有条件推演。','priorities':[{'title':'核查库存','reason':'可售是约束','evidenceIds':['ev1'],'urgency':'先核查'}],'comparisons':[{'scenarioId':'made-up','assessment':'不应出现'}],'savedChoices':[],'nextChecks':[]}
    with pytest.raises(ValueError,match='方案'):validate_organization(finding(organization=report),{'ev1'}, {})
    report['comparisons']=[];report['priorities'][0]['evidenceIds']=['missing']
    with pytest.raises(ValueError,match='证据'):validate_organization(finding(organization=report),{'ev1'}, {})

def test_daily_patrol_survives_restart_and_is_idempotent(tmp_path):
    path=tmp_path/'jobs.sqlite';c=sqlite3.connect(path);c.row_factory=sqlite3.Row
    c.execute('CREATE TABLE jobs(id TEXT PRIMARY KEY,hash TEXT,payload TEXT,status TEXT,steps TEXT,result TEXT,error TEXT,created_at TEXT,updated_at TEXT)')
    c.execute('CREATE TABLE patrol_watches(scope TEXT PRIMARY KEY,snapshot_id TEXT,payload TEXT,last_day TEXT,updated_at TEXT)')
    job=Job(id='x',businessId='b1',dataNature='demo',snapshotId='snap1',sessionId='s',mode='joint',purpose='patrol',autoRepeat=True,question='主动巡检',envelope=fixture())
    register_watch(c,job,'2026-10-04');c.execute("UPDATE patrol_watches SET last_day='2026-10-03'");c.commit();c.close()
    c=sqlite3.connect(path);c.row_factory=sqlite3.Row;moment=datetime(2026,10,3,17,tzinfo=timezone.utc)
    enqueue_due(c,'2026-10-04',moment);enqueue_due(c,'2026-10-04',moment)
    rows=c.execute('SELECT payload FROM jobs').fetchall();assert len(rows)==1
    payload=json.loads(rows[0]['payload']);assert payload['snapshotId']=='snap1';assert payload['businessId']=='b1';assert payload['purpose']=='patrol'

class OrganizedModel(MockModel):
    async def call(self,messages,tools=None):
        professional=any(x in messages[0]['content'] for x in ['NEO 的转化纠察','NEO 的供需纠察','NEO 的市场观察'])
        section='supply' if 'NEO 的供需纠察' in messages[0]['content'] else 'market' if 'NEO 的市场观察' in messages[0]['content'] else 'conversion'
        if messages[-1]['role']!='tool':
            return {'role':'assistant','content':None,'tool_calls':[{'id':name,'type':'function','function':{'name':name,'arguments':json.dumps({'section':section}) if name=='read_business' else '{}'}} for name in (['describe_business','read_business'] if professional else ['describe_business','read_business','read_decisions'])]},{}
        value=finding(organization={'headline':'先核查供给','summary':'证据仍不支持因果判断。','priorities':[{'title':'先核实库存','reason':'供给可能是约束，需核查','evidenceIds':['ev1'],'urgency':'先核查'}],'comparisons':[],'savedChoices':[],'nextChecks':['确认供给条件']}).model_dump()
        if 'organization必须为null' in messages[0]['content']:value['organization']=None
        return {'role':'assistant','content':json.dumps(value)},{}

@pytest.mark.parametrize('purpose',['patrol','weekly','briefing'])
def test_actual_organization_graph_uses_tools_and_persists(tmp_path,purpose):
    async def run():
        j=Job(id=purpose,businessId='b1',dataNature='demo',snapshotId='snap1',sessionId='s',mode='joint' if purpose=='patrol' else 'orchestrator',purpose=purpose,question='审查并整理经营',envelope=fixture())
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'cp.sqlite')) as saver:
            r=AgentRuntime(saver,model=OrganizedModel());out=await r.graph.ainvoke({'job':j.model_dump()}, {'configurable':{'thread_id':purpose}})
            assert out['result']['finding']['organization']['headline']=='先核查供给'
            if purpose=='patrol':assert set(out['result']['specialists'])=={'conversion','supply','market'}
    asyncio.run(run())

def test_aggregation_reads_beyond_sample_and_keeps_missing_cost_missing():
    env=fixture();env['facts']=[{'id':str(i),'kind':'events','fact':{'business_date':'2026-07-06','product_id':'P1','channel':'c1','event_type':'inquiry','quantity':3}} for i in range(125)]
    value=read_fact_view(env,'conversion',{})
    assert value['truncated'] and len(value['facts'])==20
    group=value['productChannelAggregates'][0]
    assert group['behaviorCounts']['A3']==375 and group['paidUnits'] is None and group['spendCents'] is None

def test_at_mention_selects_only_requested_specialist_but_patrol_still_reviews_three():
    async def run():
        r=AgentRuntime(None,model=MockModel())
        j={'id':'m','mode':'joint','question':'@供需纠察 核查库存'}
        assert (await r.route({'job':j}))['selected']==['supply']
        j['purpose']='patrol'
        assert len((await r.route({'job':j}))['selected'])==3
    asyncio.run(run())

def test_rejected_cross_domain_tool_is_not_counted_as_business_evidence():
    class WrongToolModel(MockModel):
        def __init__(self):self.queried=False
        async def call(self,messages,tools=None):
            if not self.queried:
                self.queried=True
                return {'role':'assistant','content':None,'tool_calls':[{'id':'map','function':{'name':'describe_business','arguments':'{}'}},{'id':'wrong','function':{'name':'read_business','arguments':'{"section":"supply"}'}}]},{}
            return {'role':'assistant','content':finding().model_dump_json()},{}
    async def run():
        r=AgentRuntime(None,model=WrongToolModel())
        with pytest.raises(Exception,match='未能完成必要的数据核查'):
            await r.specialist({'job':{'id':'x','question':'查转化','dataNature':'demo','envelope':fixture()}},'conversion')
    asyncio.run(run())

@pytest.mark.parametrize('role,first_reads',[
    ('conversion',['read_business']),
    ('orchestrator',['describe_business','read_decisions']),
])
def test_early_answer_gets_missing_reads_before_returning(role,first_reads):
    class EarlyAnswerModel(MockModel):
        def __init__(self):self.turn=0;self.tool_choices=[]
        async def call(self,messages,tools=None):
            self.turn+=1
            names=[t['function']['name'] for t in tools or []]
            self.tool_choices.append(names)
            if self.turn in (1,3):
                chosen=first_reads if self.turn==1 else [name for name in names if name!='query_objects']
                return {'role':'assistant','content':None,'tool_calls':[{'id':f'{self.turn}-{name}','type':'function','function':{'name':name,'arguments':json.dumps({'section':'conversion'}) if name=='read_business' else '{}'}} for name in chosen]},{}
            return {'role':'assistant','content':finding().model_dump_json()},{}
    async def run():
        model=EarlyAnswerModel();steps=[]
        async def progress(ident,message):steps.append(message)
        r=AgentRuntime(None,model=model,progress=progress)
        result,_,_,reads=await r.specialist({'job':{'id':'x','question':'查经营','dataNature':'demo','envelope':fixture()}},role)
        assert result['evidenceIds']==['ev1']
        assert all(read['status']=='completed' for read in reads)
        assert {'describe_business','read_business'}<={read['tool'] for read in reads}
        assert '补齐业务结构与经营证据查询' in steps
        # This fixture has no Ontology projection; do not advertise a tool
        # that cannot read it. The actual business read remains mandatory.
        assert set(model.tool_choices[2])==({'describe_business'} if role=='conversion' else {'read_business'})
    asyncio.run(run())

def test_failed_next_specialist_preserves_previous_checkpoint(tmp_path):
    class FailingSupply(OrganizedModel):
        async def call(self,messages,tools=None):
            if 'NEO 的供需纠察' in messages[0]['content']:raise ValueError('模型暂不可用')
            return await super().call(messages,tools)
    async def run():
        j=Job(id='partial',businessId='b1',dataNature='demo',snapshotId='snap1',sessionId='s',mode='joint',purpose='patrol',question='主动巡检',envelope=fixture())
        config={'configurable':{'thread_id':'partial'}}
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'cp.sqlite')) as saver:
            r=AgentRuntime(saver,model=FailingSupply())
            with pytest.raises(ValueError,match='模型暂不可用'):await r.graph.ainvoke({'job':j.model_dump()},config)
            checkpoint=await r.graph.aget_state(config)
            assert list(checkpoint.values['findings'])==['conversion']
            r.model=OrganizedModel()
            outcome=await r.graph.ainvoke(None,config)
            assert set(outcome['result']['specialists'])=={'conversion','supply','market'}
    asyncio.run(run())
