import pytest
from neo_agent.contracts import Finding
from neo_agent.market_workbench import validate_market_workbench

def test_explicit_trends_match_computed_channels_and_cells():
    from neo_agent.market_workbench import check_metric_directions
    row={'name':'任意渠道','previous':{'intent':30,'paidOrders':11,'netRevenueCents':48000},'current':{'intent':23,'paidOrders':11,'netRevenueCents':33000},'changes':{'intent':-.23,'paidOrders':0,'netRevenue':-.31}}
    check_metric_directions('意向回落、订单持平，净成交下降',row)
    with pytest.raises(ValueError,match='方向错误'):check_metric_directions('意向与订单回落',row)
    row['changes']['paidOrders']=.41;row['current']['paidOrders']=24;row['previous']['paidOrders']=17
    with pytest.raises(ValueError,match='方向错误'):check_metric_directions('渠道订单小幅回落',row)
    check_metric_directions('订单增长，净成交下降',row)

def test_units_and_directions_are_reported_together_for_model_repair():
    p=payload();p['marketWorkbench']['cells'][0]['summary']='意向与订单均持平在2笔'
    p['marketWorkbench']['judgment']['summary']='测试渠道订单回落'
    row={'channel':'shop','role':'core','name':'测试渠道','evidenceId':'cell','current':{'intent':2,'paidOrders':2},'previous':{'intent':2,'paidOrders':1},'changes':{'intent':0,'paidOrders':1}}
    basis={'cells':[row],'channels':[row],'sourceCandidates':[{'id':'source','verificationStatus':'source_read'}]}
    with pytest.raises(ValueError) as error:validate_market_workbench(Finding(**p),basis,[],{'cell','source'})
    assert '本期意向2次，支付订单2笔' in str(error.value) and '订单回落' in str(error.value)

def test_one_sentence_can_describe_opposite_channel_trends():
    p=payload();p['marketWorkbench']['judgment']['summary']='抖音净成交下降、天猫净成交上升'
    channels=[{'channel':'douyin','name':'抖音模拟店铺','evidenceId':'cell','changes':{'netRevenue':-.3}},{'channel':'tmall','name':'天猫模拟店铺','evidenceId':'cell','changes':{'netRevenue':.3}}]
    basis={'cells':[{'channel':'shop','role':'core','evidenceId':'cell'}],'channels':channels,'sourceCandidates':[{'id':'source','verificationStatus':'source_read'}]}
    validate_market_workbench(Finding(**p),basis,[],{'cell','source'})

def payload():
    return dict(conclusion='核查渠道承接',evidenceIds=['cell'],alternatives=[],gaps=[],candidates=[],businessReview={'title':'本专业判断','summary':'经营解释','evidenceIds':['cell']},marketWorkbench={'judgment':{'title':'渠道判断','summary':'先核查承接','evidenceIds':['cell']},'signals':[{'id':k,'title':'模型判断','summary':'模型解释','evidenceIds':['cell']} for k in ['demand','competition','efficiency']],'cells':[{'channel':'shop','role':'core','headline':'成交承接走弱','summary':'先核查可售','status':'needs_check','evidenceIds':['cell']}],'sources':[{'id':'source','selected':True,'category':'competition','reason':'与品类有关','summary':'模型提炼的产品变化','relevance':'可对照规格和价带'}],'nextStep':'核查可售'})

def test_model_contract_checks_every_cell_and_source_and_rejects_unread_citations():
    basis={'cells':[{'channel':'shop','role':'core','evidenceId':'cell'}],'sourceCandidates':[{'id':'source','verificationStatus':'source_read'}]}
    validate_market_workbench(Finding(**payload()),basis,[],{'cell','source'})
    p=payload();p['marketWorkbench']['cells']=[]
    with pytest.raises(ValueError,match='逐格'):validate_market_workbench(Finding(**p),basis,[],{'cell','source'})
    p=payload();p['marketWorkbench']['cells'][0]['evidenceIds']=['source']
    with pytest.raises(ValueError,match='对应'):validate_market_workbench(Finding(**p),basis,[],{'cell','source'})
    p=payload();p['marketWorkbench']['judgment']['evidenceIds']=['source']
    with pytest.raises(ValueError,match='整体判断'):validate_market_workbench(Finding(**p),basis,[],{'cell','source'})
    p=payload();p['gaps']=['E052未读取']
    with pytest.raises(ValueError,match='短引用'):validate_market_workbench(Finding(**p),basis,[],{'cell','source'})
    p=payload();p['marketWorkbench']['cells'][0]['summary']='意向与订单均为2笔'
    with pytest.raises(ValueError,match='按次'):validate_market_workbench(Finding(**p),basis,[],{'cell','source'})
    p=payload();p['marketWorkbench']['cells'][0]['summary']='意向6次、支付订单5笔'
    validate_market_workbench(Finding(**p),basis,[],{'cell','source'})
    p=payload();p['marketWorkbench']['cells'][0]['headline']='量稳价降'
    with pytest.raises(ValueError,match='不能证明降价'):validate_market_workbench(Finding(**p),basis,[],{'cell','source'})
    p=payload();p['marketWorkbench']['sources'][0]['category']='policy'
    validate_market_workbench(Finding(**p),basis,[],{'cell','source'})
    basis['signals']=[{'id':'efficiency','name':'渠道效率','delta':.016,'value':'+1.6%'}]
    p=payload();p['marketWorkbench']['signals'][2]['title']='每笔订单投放下降'
    with pytest.raises(ValueError,match='方向'):validate_market_workbench(Finding(**p),basis,[],{'cell','source'})
    basis['sourceCandidates'][0]['verificationStatus']='unavailable'
    with pytest.raises(ValueError,match='原文'):validate_market_workbench(Finding(**payload()),basis,[],{'cell','source'})
    with pytest.raises(ValueError,match='没有'):validate_market_workbench(Finding(**payload()),None,[],{'cell','source'})

@pytest.mark.parametrize('search_failed',[False,True])
def test_workbench_basis_reaches_model_after_business_projection(tmp_path,search_failed):
    import asyncio,json
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
    from neo_agent.agent import AgentRuntime
    from neo_agent.contracts import Job
    from test_engine import fixture
    captured=[];answers=[]
    basis={'cells':[{'channel':'shop','role':'core','evidenceId':'cell','current':{'paidOrders':2,'spendCents':1200}}],'sourceCandidates':[{'id':'source','verificationStatus':'source_read'}],'evidenceIds':['cell','source']}
    class Model:
        name='OFFLINE_MARKET_PROJECTION_TEST'
        async def call(self,messages,tools=None):
            for m in messages:
                if m.get('role')=='tool':
                    content=json.loads(m['content']).get('result',{})
                    if 'marketWorkbenchBasis' in content:captured.append(content['marketWorkbenchBasis'])
            names={t['function']['name'] for t in tools or []}
            if 'describe_business' in names:specs=[('describe_business',{}),('read_business',{'section':'market','grain':'period','periodStart':'2026-08-24','periodEnd':'2026-09-20'})]
            elif 'search_market' in names:specs=[('search_market',{'query':'测试行业'})]
            else:
                answers.append(messages[:])
                answer=payload();answer['businessReview']=None
                answer['evidenceIds']=['E001'];answer['marketWorkbench']['judgment']['evidenceIds']=['E001']
                for x in answer['marketWorkbench']['signals']+answer['marketWorkbench']['cells']:x['evidenceIds']=['E001']
                answer['marketWorkbench']['sources'][0]['id']='E002'
                if len(answers)==1:answer['marketWorkbench']['sources']=[]
                return {'role':'assistant','content':json.dumps(answer)},{}
            return {'role':'assistant','tool_calls':[{'id':str(i)+n,'type':'function','function':{'name':n,'arguments':json.dumps(a)}} for i,(n,a) in enumerate(specs)]},{}
    class Market:
        async def search(self,*args):
            if search_failed:
                from neo_agent.providers import ProviderError
                raise ProviderError('原文查询暂不可用')
            return []
    async def run():
        env=fixture();env['marketWorkbenchBasis']=basis
        j=Job(id='market-projection',businessId='b1',dataNature='demo',snapshotId='snap1',sessionId='s',mode='market',purpose='review',question='渠道分析',envelope=env,budget={'maxMarketSearches':2}).model_dump(mode='json')
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'cp.sqlite')) as saver:
            out=await AgentRuntime(saver,model=Model(),market=Market()).graph.ainvoke({'job':j},{'configurable':{'thread_id':j['id']}})
            assert out['result']['finding']['marketWorkbench']['cells'][0]['channel']=='shop'
            assert out['result']['finding']['businessReview']==out['result']['finding']['marketWorkbench']['judgment']
    asyncio.run(run())
    assert captured and captured[0]['cells'][0]['current']=={'paidOrders':2,'spendYuan':12}
    assert len(answers)==2 and '"id": "E002"' in answers[1][-1]['content']

def test_short_citations_restore_only_known_references_and_preserve_business_values():
    import json
    from neo_agent.market_workbench import citation_view,restore_citations
    aliases={'E001':'tenant:snapshot:source-original'}
    shown=citation_view({'evidenceIds':['tenant:snapshot:source-original'],'channel':'E001'},aliases)
    assert shown=={'evidenceIds':['E001'],'channel':'E001'}
    restored=json.loads(restore_citations(json.dumps({'evidenceIds':['E001','E999'],'channel':'E001','sources':[{'id':'E001'}]}),aliases))
    assert restored['channel']=='E001' and restored['evidenceIds']==['tenant:snapshot:source-original','E999']
    assert restored['sources'][0]['id']=='tenant:snapshot:source-original'
    named=json.loads(restore_citations(json.dumps({'channel':'E001','sources':[{'id':'E001','reason':'与E001是同一原文，E999未确认'}]}),aliases,{'E001':'品牌公开战报'}))
    assert named['sources'][0]['reason']=='与品牌公开战报是同一原文，E999未确认'
    assert named['channel']=='E001'
