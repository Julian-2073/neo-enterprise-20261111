import asyncio,json
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from neo_agent.professional_reviews import journey_changes,validate_review
from neo_agent.agent import AgentRuntime
from neo_agent.contracts import Finding,Job
from test_engine import fixture

def test_journey_compares_four_stages_without_cross_unit_rates():
    weeks=[{'behaviorCounts':{'A1':10,'A2':8,'A3':6,'A5':999},'paidOrders':4} for _ in range(4)]+[{'behaviorCounts':{'A1':20,'A2':16,'A3':12,'A5':999},'paidOrders':3} for _ in range(4)]
    result=journey_changes(weeks,{'cohortCustomers':10})
    assert [s['stage'] for s in result['stages']]==['A1','A2','A3','A4']
    assert [s['changeRate'] for s in result['stages']]==[1,1,1,-.25]
    assert result['stages'][3]['unit']=='笔'
    weeks[-1]['metricStatus']={'A3':{'status':'partial','knownValue':12}}
    assert journey_changes(weeks)['stages'][2]['recent'] is None
    assert journey_changes(weeks[:3])['stages'][0]['recent'] is None
    for w in weeks:w['behaviorCounts']['A1']=0
    assert journey_changes(weeks)['stages'][0]['changeRate'] is None

def test_review_requires_complete_own_scope_and_readable_sources():
    f=Finding(conclusion='本专业判断',evidenceIds=['ev1'],alternatives=[],gaps=[],candidates=[],businessReview={'title':'需要核查承接','summary':'具体经营含义','evidenceIds':['ev1']})
    validate_review(f,{'ev1'},'conversion',{'conversion'},[])
    with pytest.raises(ValueError):validate_review(f,{'ev1'},'conversion',set(),[])
    f.businessReview.evidenceIds=['market-unread']
    with pytest.raises(ValueError,match='原文'):validate_review(f,{'ev1','market-unread'},'market',{'market'},[{'id':'market-unread','verificationStatus':'unavailable'}])

@pytest.mark.parametrize('mode',['conversion','supply','market'])
def test_each_review_has_one_professional_full_scope_and_no_orchestrator(tmp_path,mode):
    calls=[]
    journey_reads=[]
    class Model:
        name='OFFLINE_REVIEW_TEST'
        async def call(self,messages,tools=None):
            for message in messages:
                if message.get('role')=='tool' and message.get('content'):
                    content=json.loads(message['content']).get('result',{})
                    if isinstance(content,dict) and 'customerJourney' in content:
                        journey_reads.append(content['customerJourney'])
            names={t['function']['name'] for t in tools or []}
            assert not names & {'forecast','simulate_scenario','read_decisions'}
            calls.append(names)
            if 'describe_business' in names:
                specs=[('describe_business',{}),('read_business',{'section':mode,'grain':'period'})]
            elif 'search_market' in names:specs=[('search_market',{'query':'健身器材行业 官方'})]
            else:
                assert tools is None
                finding={'conclusion':'先核查本专业经营变化。','evidenceIds':['ev1'],'alternatives':[],'gaps':[],'candidates':[],'followups':[],'businessReview':{'title':'本专业变化需核查','summary':'审查结果来自本专业经营资料','evidenceIds':['ev1']}}
                return {'role':'assistant','content':json.dumps(finding)},{}
            return {'role':'assistant','tool_calls':[{'id':str(i)+name,'type':'function','function':{'name':name,'arguments':json.dumps(a)}} for i,(name,a) in enumerate(specs)]},{}
    class Market:
        async def search(self,*args):return [{'id':'market-read','verificationStatus':'source_read','title':'测试来源','url':'https://example.invalid','retrievedAt':'2026-10-06'}]
    async def run():
        env=fixture()
        env['customerJourney']={'version':'customer-journey-v1','period':{'counts':{'A1':145,'A2':107,'A3':68,'A4':46},'transitions':[{'from':'A3','to':'A4','rate':2/3}]},'weekly':[{'shouldNotBeInModel':True}]}
        job=Job(id='review-test',businessId='b1',dataNature='demo',snapshotId='snap1',sessionId='review-s',mode=mode,purpose='review',question='专业审查',envelope=env,budget={'maxMarketSearches':2 if mode=='market' else 0}).model_dump(mode='json')
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'cp.sqlite')) as saver:
            out=await AgentRuntime(saver,model=Model(),market=Market()).graph.ainvoke({'job':job},{'configurable':{'thread_id':job['id']}})
            assert out['selected']==[mode];assert set(out['result']['specialists'])=={mode};assert not out['followupTargets']
            assert out['result']['finding']['businessReview']['title']=='本专业变化需核查'
            reads=out['result']['toolReads'];assert all(r.get('parentId')==mode for r in reads if r['tool'] not in ('read_knowledge',))
            from neo_agent.business_tools import describe_business
            view=describe_business(env)['availableDerivedViews']['customerJourney']
            assert view['matchesCurrentScope'] is False and view['scopeStatus']=='unverified_legacy_period'
            assert view['evidenceId'] is None
            assert any(r['tool']=='search_market' for r in reads)==(mode=='market')
            if mode=='conversion':
                assert journey_reads
                assert journey_reads[0]['period']['counts']['A4']==46
                assert 'weekly' not in journey_reads[0]
    asyncio.run(run())
