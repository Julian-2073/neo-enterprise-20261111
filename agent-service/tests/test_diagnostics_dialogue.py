import copy
import pytest
from neo_agent.business_queries import query_facts
from neo_agent.task_plan import plan_task
from test_unified_runtime import job

def test_count_query_memory_preserves_scope_and_constraints_without_failed_dossiers():
    from neo_agent.scoped_queries import model_conversation
    context={'versionChanged':True,'sourceChanged':False,'currentInputId':'new',
             'previousInputId':'old','notice':'重新查询事实',
             'active':{'entityId':'sku-a','channelId':'channel-a','period':{'start':'2026-09-01','end':'2026-09-30'},'unfinishedInquiry':[{'runId':'failed'}]},
             'memory':{'status':'historical_context_only','topics':[{'value':'x'*500}]*12,
                       'ruleReferences':[{'value':'y'*500}]*8,
                       'constraints':[{'value':'退款未返库'}],
                       'unfinishedInquiry':[{'runId':'failed'}]},'recentTurns':[{'status':'failed'}]}
    original=copy.deepcopy(context)
    projected=model_conversation(context,count_query=True)
    assert projected['active']['entityId']=='sku-a'
    assert projected['active']['period']==context['active']['period']
    assert projected['currentInputId']=='new' and projected['versionChanged'] is True
    assert projected['memory']['constraints']==context['memory']['constraints']
    assert projected['memory']['unfinishedInquiryCount']==1
    assert 'ruleReferences' not in projected['memory'] and 'topics' not in projected['memory']
    assert 'ruleReferences' in model_conversation(context)['memory']
    assert context==original


def test_full_record_paging_and_exact_filter_are_not_samples():
    env=job()['envelope']
    original=next(r for r in env['facts'] if r['kind']=='orders')
    env['facts']=[{**copy.deepcopy(original),'id':f'row-{i:03d}'} for i in range(65)]
    first=query_facts(env,'conversion',{'recordLimit':20})
    assert first['recordsPage']['total']==65
    assert first['recordsPage']['hasMore'] is True
    second=query_facts(env,'conversion',{'recordCursor':20,'recordLimit':20})
    assert second['facts'][0]['id']=='row-020'
    exact=query_facts(env,'conversion',{'recordId':'row-064'})
    assert [r['id'] for r in exact['facts']]==['row-064']
    assert exact['totals']['factCount']==65
    with pytest.raises(ValueError):query_facts(env,'conversion',{'recordCursor':-1})


def test_cross_domain_plan_is_selective_and_complex_decide_uses_frozen_scenarios():
    diagnostic=plan_task(job(question='诊断转化退款和库存缺口',mode='joint'))
    assert diagnostic['selected']==['conversion','supply']
    assert diagnostic['answerContract']['intent'].startswith('找出最关键')
    assert diagnostic['answerContract']['workflow'][1]=='只读取回答所需的经营数据'
    assert list(diagnostic['answerContract']['visible'])==['conclusion','basis','nextStep']
    assert plan_task(job(question='诊断转化退款和渠道费用',mode='joint'))['selected']==['conversion','market']
    j=job(question='优先选择哪个',mode='joint',taskType='DECIDE')
    j['envelope']['scenarioContext']={'results':[{'id':'a'},{'id':'b'}]}
    assert plan_task(j)['budgetClass']=='scenario'

from neo_agent.claim_support import validate_claims
from neo_agent.execution import ExecutionError

def test_real_citation_does_not_allow_order_new_customer_or_ranking_demand_claims():
    scope={'businessId':'b','dataNature':'demo','inputId':'s'}
    for statement,ref in [('新增客户达到订单规模',{'id':'metric:paidOrders','kind':'metric','exact':'{"value":20}'}),('市场需求增长',{'id':'doc:paragraph:0','kind':'paragraph','exact':'品牌排行榜发布'})]:
        verdict={'claims':[{'index':0,'status':'supported','references':[{'id':ref['id'],'quote':ref['exact']}],'applicability':'本企业本期','counterevidence':[],'gaps':[]}]}
        with pytest.raises(ExecutionError):validate_claims(verdict,[{'path':'finding','statement':statement}],{ref['id']:ref},scope)
    verdict={'claims':[{'index':0,'status':'supported','references':[{'id':'metric:paidOrders','quote':'伪造原句'}],'applicability':'本期','counterevidence':[],'gaps':[]}]}
    with pytest.raises(ValueError):validate_claims(verdict,[{'path':'finding','statement':'资料需核实'}],{'metric:paidOrders':{'exact':'实际原文'}},scope)

from neo_agent.scoped_queries import scoped_read

def test_canonical_full_paging_and_typed_saved_calculation_scope():
    b=job('generation')['envelope']['operatingBasis']
    b['queryData']={'businessId':'b1','dataNature':'demo','generationId':'g','asOf':'2026-09-30','knownAt':'2026-09-30','period':b['period'],'records':[{'id':str(i),'kind':'order','businessDate':'2026-09-20','entityId':'a','knownAt':'2026-09-30'} for i in range(65)]}
    assert scoped_read(b,'read_frozen_records',{'cursor':60})['total']==65
    assert len(scoped_read(b,'read_frozen_records',{'cursor':60})['records'])==5
    with pytest.raises(ValueError):scoped_read(b,'read_frozen_records',{'start':'2020-01-01'})
    b['savedRecords']={'businessId':'b1','dataNature':'demo','generationId':'g','registryHash':'h','fullRecords':[{'id':'old','kind':'business_scenario_bundle','businessId':'b1','dataNature':'demo','generationId':'g','results':[{'id':'a','totals':{'contributionMarginCents':123}}]}]}
    assert scoped_read(b,'read_saved_records',{'id':'old','typed':True})['records'][0]['results'][0]['totals']['contributionMarginCents']==123
    b['queryData']['dataNature']='business'
    with pytest.raises(ValueError):scoped_read(b,'read_frozen_records',{})

import asyncio,json
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from neo_agent.agent import AgentRuntime


def test_in_transit_query_has_deterministic_business_answer():
    from neo_agent.agent import deterministic_fact_answer
    env=job()['envelope']
    snapshot=env['snapshot'];snapshot['evidenceIds']['supply']='ev-supply'
    env['facts']=[
        {'id':'stock-1','kind':'inventory','fact':{'business_id':snapshot['businessId'],'data_nature':snapshot['dataNature'],'business_date':snapshot['asOf'],'product_id':'sim-X2','sku_id':'sim-X2-S1','warehouse_id':'sim-W-east','sellable_units':2,'in_transit_units':1,'inventory_cost_cents':100,'safety_units':1}},
        {'id':'stock-2','kind':'inventory','fact':{'business_id':snapshot['businessId'],'data_nature':snapshot['dataNature'],'business_date':snapshot['asOf'],'product_id':'sim-X2','sku_id':'sim-X2-S2','warehouse_id':'sim-W-east','sellable_units':2,'in_transit_units':1,'inventory_cost_cents':100,'safety_units':1}},
    ]
    env['domain']={'skus':[{'id':'sim-X2-S1','skuId':'sim-X2-S1','name':'旗舰跑步机 X2 模拟规格1'},{'id':'sim-X2-S2','skuId':'sim-X2-S2','name':'旗舰跑步机 X2 模拟规格2'}],
                   'warehouses':[{'id':'sim-W-east','warehouseId':'sim-W-east','name':'模拟东仓'}],
                   'arrivals':[{'id':'plan-1','skuId':'sim-X2-S1','warehouseId':'sim-W-east','date':'2026-09-28','units':1,'status':'planned'},
                               {'id':'plan-2','skuId':'sim-X2-S2','warehouseId':'sim-W-east','date':'2026-09-28','units':1,'status':'planned'}]}
    result=deterministic_fact_answer(env,'supply','查看在途','QUERY')
    assert result['answerIntent']=='查看当前在途库存及已记录到货计划'
    assert '当前在途共2件' in result['conclusion']
    assert '旗舰跑步机 X2 模拟规格1在模拟东仓1件' in result['conclusion']
    assert '已记录到货计划共2件' in result['basis'][1]
    assert '旗舰跑步机 X2 模拟规格1至模拟东仓1件（2026-09-28，计划中）' in result['basis'][1]
    assert '旗舰跑步机 X2 模拟规格2至模拟东仓1件（2026-09-28，计划中）' in result['basis'][1]
    assert result['nextStep'] is None and result['alternatives']==result['candidates']==result['followups']==[]
    assert result['gaps']==['待确认：上述计划是否对应当前在途批次。']
    from neo_agent.claim_support import statement_type
    assert statement_type(result['gaps'][0])=='verification_request'


def test_order_count_query_has_deterministic_business_answer():
    from neo_agent.agent import deterministic_fact_answer
    env=job()['envelope'];snapshot=env['snapshot']
    snapshot['evidenceIds']['paidOrders']='ev-orders'
    env['facts']=[
        {'id':'paid-1','kind':'orders','source_id':'erp','fact':{'business_id':snapshot['businessId'],'data_nature':snapshot['dataNature'],'business_date':snapshot['periodStart'],'entry_type':'paid','order_id':'paid-order','quantity':3,'amount_cents':30000,'variable_cost_cents':10000}},
        {'id':'refund-1','kind':'orders','source_id':'erp','fact':{'business_id':snapshot['businessId'],'data_nature':snapshot['dataNature'],'business_date':snapshot['periodStart'],'entry_type':'refund','order_id':'refund-order','quantity':1,'amount_cents':10000,'variable_cost_cents':0}},
    ]
    result=deterministic_fact_answer(env,'conversion','当前统计期支付订单和退款分别有多少笔？','QUERY')
    assert result['conclusion']=='统计期内支付订单1笔（3件），退款订单1笔（1件）。'
    assert result['basis']==['支付按来源与订单号去重为1笔，商品数量合计3件','退款按来源与订单号去重为1笔，商品数量合计1件']
    assert result['nextStep'] is None and result['gaps']==[]
    assert result['evidenceIds']==['ev-orders']


def test_channel_spend_query_has_deterministic_business_answer():
    import gzip
    from pathlib import Path
    from neo_agent.agent import deterministic_fact_answer
    from neo_agent.ontology import expand_ontology
    saved=json.loads(gzip.decompress((Path(__file__).parent/'fixtures/task4-live-legacy-query.json.gz').read_bytes()))
    env=expand_ontology(saved['envelope'])
    result=deterministic_fact_answer(env,'market','统计期内，各渠道分别记录了多少投放费用？','QUERY')
    assert result['conclusion']=='统计期内，抖音模拟店铺投放费用13750.00元，天猫模拟店铺10000.00元。'
    assert result['basis']==['两个渠道合计投放费用23750.00元','统计期为2026-04-06至2026-09-20']
    assert result['evidenceIds']==[env['snapshot']['evidenceIds']['spendCents']]


def test_industry_change_question_reports_missing_external_evidence_without_failing(tmp_path):
    from neo_agent.agent import deterministic_fact_answer
    request=job(question='哪些行业变化与我有关',mode='market',taskType='DIAGNOSE');env=request['envelope']
    result=deterministic_fact_answer(env,'market',request['question'],'DIAGNOSE')
    assert result['answerIntent']=='判断当前资料能否识别相关行业变化'
    assert result['conclusion']=='当前还不能判断哪些行业变化与你有关：已保存资料没有可核对的行业、政策或竞品原文，本轮也未启用外部市场检索。'
    assert result['basis']==['现有市场资料只提供通用电商核查框架，没有当前企业适用的行业变化事实','渠道费用只反映企业内部投入，不能代替行业变化证据']
    assert result['nextStep']=='补充关注品类、经营区域和主要竞品，并开启市场原文检索后，再按“变化—与本企业的关联—应对动作”筛选。'
    assert result['evidenceIds']==[] and result['gaps']==['缺少已读取的行业、政策或竞品原文，以及企业关注的品类、区域和竞品范围。']
    class NoModel:
        name='must-not-be-called'
        async def call(self,*_args,**_kwargs):raise AssertionError('已确认外部资料缺口时不应调用模型猜测行业变化')
    observed,_=execute(tmp_path,request,NoModel())
    assert observed['status']=='completed',observed
    assert observed['observability']['modelInvocations']==0
    with_source=copy.deepcopy(env)
    with_source['decisionContext']={'marketEvidence':[{'id':'industry-source','url':'https://example.com/standard','verificationStatus':'source_read','title':'已读取原文'},{'id':'duplicate','url':'https://example.com/standard','verificationStatus':'source_read','title':'重复原文'}]}
    assert deterministic_fact_answer(with_source,'market',request['question'],'DIAGNOSE') is None
    from neo_agent.agent import saved_market_source_question,market_source_page
    assert saved_market_source_question(with_source,'market',request['question']) is True
    page=market_source_page(with_source['decisionContext'])
    assert page['candidateCount']==1 and [row['id'] for row in page['marketEvidence']]==['industry-source']
    with_source['domain']['products']=[{'id':'runner','name':'智能跑步机 S2'},{'id':'rower','name':'家用划船机 R1'},{'id':'dumbbell','name':'可调节哑铃 M1'}]
    with_source['decisionContext']={'marketEvidence':[
        {'id':'policy','url':'https://news.cn/standard','verificationStatus':'source_read','title':'新华网：跑步机等健身器材有了新国标','content':'市场监管总局发布室内固定式健身器材国家标准。'},
        {'id':'trend','url':'https://example.com/rower','verificationStatus':'source_read','title':'划船机市场格局与出口适配','content':'家用划船机品类格局变化。'},
    ]}
    answer=deterministic_fact_answer(with_source,'market',request['question'],'DIAGNOSE')
    assert answer['conclusion']=='当前最明确相关的是室内固定式健身器材新国标、划船机品类格局与产品适配变化。你的商品包含智能跑步机 S2、家用划船机 R1，所以品类直接相关；是否适用具体型号仍需核对。'
    assert '哑铃' not in answer['conclusion']
    assert answer['evidenceIds']==['policy','trend']
    with_source['decisionContext']['marketEvidence'][1]['content']='家用跑步机、划船机和哑铃市场格局与出口适配变化。'
    broad=deterministic_fact_answer(with_source,'market',request['question'],'DIAGNOSE')
    assert '家用健身器材市场与出口适配变化' in broad['conclusion']
    assert '可调节哑铃 M1' in broad['conclusion']
    with_source['decisionContext']['marketEvidence'][1]['content']='家用划船机品类格局变化。'
    request={**request,'id':'industry-sources','envelope':with_source}
    observed,_=execute(tmp_path,request,NoModel())
    assert observed['status']=='completed',observed
    assert observed['observability']['modelInvocations']==0


def test_customer_journey_comparison_has_deterministic_concise_answer():
    from neo_agent.agent import deterministic_fact_answer
    env=job()['envelope']
    env['customerJourney']={
        'version':'customer-journey-v1','evidenceId':'journey',
        'period':{'start':env['snapshot']['periodStart'],'end':env['snapshot']['periodEnd'],'transitions':[]},
        'recent':{'start':'2026-08-24','end':'2026-09-20','transitions':[{'from':'A1','to':'A2','matureCustomers':123,'convertedCustomers':84,'rate':84/123}]},
        'previous':{'start':'2026-07-27','end':'2026-08-23','transitions':[{'from':'A1','to':'A2','matureCustomers':111,'convertedCustomers':76,'rate':76/111}]},
    }
    result=deterministic_fact_answer(env,'conversion','请核对最近四周A1到A2与前四周转化率，并说明原因是否有证据','EXPLAIN')
    assert result['answerIntent']=='核对A1到A2近期转化及原因证据'
    assert result['conclusion']=='最近窗口A1→A2转化率为68.3%，前一窗口为68.5%，两期基本持平、最近略低。现有资料未记录变化原因。'
    assert result['basis']==[
        '最近窗口（2026-08-24至2026-09-20）：完成观察123人，进入A2的84人',
        '前一窗口（2026-07-27至2026-08-23）：完成观察111人，进入A2的76人',
    ]
    assert result['nextStep']=='按渠道核对未进入A2的成熟客户，再判断原因。'
    assert result['evidenceIds']==['journey'] and result['gaps']==['现有资料未记录变化原因。']


def test_largest_customer_journey_change_answers_the_ranking_directly(tmp_path):
    from neo_agent.agent import deterministic_fact_answer
    env=job()['envelope'];env['snapshot']['evidenceIds'].update({stage:f'ev-{stage.lower()}' for stage in ('A1','A2','A3','A4')})
    env['customerJourney']={
        'version':'customer-journey-v1',
        'recent':{'start':'2026-08-24','end':'2026-09-20','transitions':[
            {'from':'A1','to':'A2','matureCustomers':123,'convertedCustomers':84,'rate':84/123},
            {'from':'A2','to':'A3','matureCustomers':89,'convertedCustomers':53,'rate':53/89},
            {'from':'A3','to':'A4','matureCustomers':54,'convertedCustomers':36,'rate':36/54},
        ]},
        'previous':{'start':'2026-07-27','end':'2026-08-23','transitions':[
            {'from':'A1','to':'A2','matureCustomers':111,'convertedCustomers':76,'rate':76/111},
            {'from':'A2','to':'A3','matureCustomers':78,'convertedCustomers':46,'rate':46/78},
            {'from':'A3','to':'A4','matureCustomers':47,'convertedCustomers':24,'rate':24/47},
        ]},
        'changes':[
            {'stage':'A1','current':145,'previous':143,'change':2/143},
            {'stage':'A2','current':107,'previous':104,'change':3/104},
            {'stage':'A3','current':68,'previous':65,'change':3/65},
            {'stage':'A4','current':46,'previous':38,'change':8/38},
        ],
    }
    result=deterministic_fact_answer(env,'conversion','哪个旅程阶段变化最大','DIAGNOSE')
    assert result['answerIntent']=='找出近期客户旅程变化最大的阶段'
    assert result['conclusion']=='A4购买阶段变化最大：客户数由前一窗口38人增至最近窗口46人，增幅21.1%。同时，A3→A4转化率也变化最大，由51.1%升至66.7%。'
    assert result['basis']==[
        'A1、A2、A3、A4客户数增幅分别为1.4%、2.9%、4.6%、21.1%',
        'A1→A2、A2→A3、A3→A4转化率由前期68.5%、59.0%、51.1%变为近期68.3%、59.6%、66.7%',
    ]
    assert result['nextStep'] is None and result['gaps']==[]
    assert result['evidenceIds']==['ev-a1','ev-a2','ev-a3','ev-a4']
    class NoModel:
        name='must-not-be-called'
        async def call(self,*_args,**_kwargs):raise AssertionError('旅程排名已有完整统计，不应再调用模型')
    request=job(question='哪个旅程阶段变化最大',mode='conversion',taskType='DIAGNOSE');request['envelope']=env
    observed,_=execute(tmp_path,request,NoModel())
    assert observed['status']=='completed',observed
    assert observed['observability']['modelInvocations']==0
    assert observed['result']['finding']['conclusion']==result['conclusion']


def test_channel_customer_handoff_reports_missing_channel_journey_directly(tmp_path):
    from neo_agent.agent import deterministic_fact_answer
    request=job(question='按渠道查看客户承接',mode='conversion',taskType='DIAGNOSE');env=request['envelope']
    env['snapshot']['evidenceIds'].update({stage:f'ev-{stage.lower()}' for stage in ('A1','A2','A3','A4')})
    env['customerJourney']={
        'version':'customer-journey-v1',
        'recent':{'start':'2026-08-24','end':'2026-09-20','counts':{'A1':145,'A2':107,'A3':68,'A4':46},'transitions':[]},
        'previous':{'start':'2026-07-27','end':'2026-08-23','counts':{'A1':143,'A2':104,'A3':65,'A4':38},'transitions':[]},
    }
    result=deterministic_fact_answer(env,'conversion',request['question'],'DIAGNOSE')
    assert result['answerIntent']=='判断是否能按渠道比较客户承接'
    assert result['conclusion']=='当前不能按渠道比较客户承接：已读取的4A客户旅程只有全企业汇总，未提供渠道级去重客户人数和相邻阶段转化率。'
    assert result['basis']==['最近窗口和前一窗口的客户旅程均未包含渠道拆分','渠道行为次数和订单笔数不能替代去重客户旅程']
    assert result['nextStep']=='补充按渠道关联的客户身份与阶段记录后，再比较各渠道的相邻阶段转化。'
    assert result['gaps']==['缺少渠道级去重客户旅程。']
    class NoModel:
        name='must-not-be-called'
        async def call(self,*_args,**_kwargs):raise AssertionError('已确认的渠道旅程缺口不应调用模型猜测')
    observed,_=execute(tmp_path,request,NoModel())
    assert observed['status']=='completed',observed
    assert observed['observability']['modelInvocations']==0


def test_deterministic_query_runtime_does_not_call_model(tmp_path):
    class NoModel:
        name='must-not-be-called'
        async def call(self,*_args,**_kwargs):raise AssertionError('简单事实查询不应调用模型')
    request=job(question='当前统计期支付订单和退款分别有多少笔？',mode='conversion',taskType='QUERY')
    snapshot=request['envelope']['snapshot'];snapshot['evidenceIds']['paidOrders']='ev-orders'
    request['envelope']['facts']=[
        {'id':'paid-1','kind':'orders','sourceId':'erp','fact':{'business_date':snapshot['periodStart'],'entry_type':'paid','order_id':'paid-order','quantity':3,'amount_cents':30000,'variable_cost_cents':10000}},
        {'id':'refund-1','kind':'orders','sourceId':'erp','fact':{'business_date':snapshot['periodStart'],'entry_type':'refund','order_id':'refund-order','quantity':1,'amount_cents':10000,'variable_cost_cents':0}},
    ]
    result,_=execute(tmp_path,request,NoModel())
    assert result['status']=='completed',result
    assert result['observability']['modelInvocations']==0
    assert '支付订单' in result['result']['finding']['conclusion']
    assert result['result']['businessAssessment']['claims']


def test_deterministic_journey_explanation_runtime_does_not_call_model(tmp_path):
    class NoModel:
        name='must-not-be-called'
        async def call(self,*_args,**_kwargs):raise AssertionError('已有旅程统计的对比不应再调用模型')
    request=job(question='请核对最近四周A1到A2与前四周转化率，并说明原因是否有证据',mode='conversion',taskType='DIAGNOSE')
    env=request['envelope']
    env['snapshot']['evidenceIds'].update({'A1':'ev-a1','A2':'ev-a2'})
    env['customerJourney']={
        'version':'customer-journey-v1',
        'period':{'start':env['snapshot']['periodStart'],'end':env['snapshot']['periodEnd'],'transitions':[]},
        'recent':{'start':'2026-08-24','end':'2026-09-20','transitions':[{'from':'A1','to':'A2','matureCustomers':123,'convertedCustomers':84,'rate':84/123}]},
        'previous':{'start':'2026-07-27','end':'2026-08-23','transitions':[{'from':'A1','to':'A2','matureCustomers':111,'convertedCustomers':76,'rate':76/111}]},
    }
    result,_=execute(tmp_path,request,NoModel())
    assert result['status']=='completed',(result.get('error'),result.get('errorCode'),result.get('result',{}).get('runtime'))
    assert result['observability']['modelInvocations']==0
    assert result['result']['finding']['conclusion'].startswith('最近窗口A1→A2转化率为68.3%')
    assert result['result']['finding']['gaps']==['现有资料未记录变化原因。']
    assert result['result']['businessAssessment']['claims']
from neo_agent.operating_reviews import OperatingAgentRuntime
from neo_agent.runner import run_once
from neo_agent.engine import source_hash
from neo_agent.job_queue import JobQueue
from test_unified_runtime import QueryModel,CanonicalQueryModel,execute

@pytest.mark.parametrize('source,node',[('snapshot','investigate'),('generation','supply')])
def test_actual_legacy_checkpoint_resumes_old_node_and_keeps_prior_state(tmp_path,source,node):
    async def run():
        j=job(source);q=JobQueue(tmp_path/'q');q.initialize();q.submit(j,source_hash(j))
        # These are persisted pre-runtime jobs with their original admission limits.
        from neo_agent.job_queue import DEFAULT_LIMITS
        with q.db(immediate=True) as db:db.execute('UPDATE jobs SET limits_json=? WHERE id=?',(json.dumps(DEFAULT_LIMITS),j['id']))
        model=QueryModel() if source=='snapshot' else CanonicalQueryModel()
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'cp')) as saver:
            runtime=(AgentRuntime if source=='snapshot' else OperatingAgentRuntime)(saver,model=model)
            config={'configurable':{'thread_id':j['id']}}
            await runtime.graph.ainvoke({'job':j},config,interrupt_before=[node])
            before=await runtime.graph.aget_state(config);assert before.next==(node,)
            assert not before.values.get('runtimePlan')
            prior=dict(before.values.get('reviews') or before.values.get('findings') or {})
            assert await run_once(q,'worker',saver,model_factory=lambda:model)
            result=q.observe(j['id']);assert result['status']=='completed',result
            after=await runtime.graph.aget_state(config)
            for k,v in prior.items():assert after.values['reviews' if source=='generation' else 'findings'][k]==v
            assert result['result'].get('businessAssessment') is None # Historical graph remains historical.
            assert after.values['job']==j
    asyncio.run(run())


def test_semantic_gate_rejects_definitive_irrelevant_true_citation_before_save(tmp_path):
    class Adversarial(CanonicalQueryModel):
        async def call(self,messages,tools=None):
            response,usage=await super().call(messages,tools)
            if not messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
                value=json.loads(response['content']);value['explanation']='新增客户达到订单规模';response['content']=json.dumps(value)
            return response,usage
    r,_=execute(tmp_path,job('generation'),Adversarial())
    assert r['status']=='failed' and r['observability']['errorCode']=='CLAIM_NOT_SUPPORTED',r
    assert r['result']['verifiedMetrics']['paidOrders']['value']==20
    assert r['result']['finding'] is None and not r['result'].get('businessAssessment')

@pytest.mark.parametrize('question,roles',[('诊断转化退款与库存缺口',{'conversion','supply'}),('诊断转化退款、库存供给与渠道费用',{'conversion','supply','market'})])
@pytest.mark.parametrize('source',['snapshot','generation'])
def test_cross_specialty_runtime_reads_every_relevant_domain_under_cap(tmp_path,source,question,roles):
    request=job(source,question=question,mode='joint')
    r,_=execute(tmp_path,request,QueryModel() if source=='snapshot' else CanonicalQueryModel())
    assert r['status']=='completed',r
    assert set(r['result']['specialists'])==roles
    if source=='snapshot':
        assert roles<={v.get('arguments',{}).get('section') for v in r['result']['toolReads'] if v['tool']=='read_business'}
        assert set(r['result']['businessAssessment']['context']['diagnostics']['sections'])==roles
    else:assert set(r['result']['operatingReviews'])==roles|{'joint'}
    assert r['observability']['modelInvocations']<=8


def test_canonical_two_inquiry_rounds_and_typed_scenario_connection(tmp_path):
    from test_operating_reviews import answer
    request=job('generation',question='诊断订单明细',mode='conversion')
    basis=request['envelope']['operatingBasis']
    basis['queryData']={'businessId':'b1','dataNature':'demo','generationId':'g','knownAt':'2026-09-30','asOf':'2026-09-30','period':basis['period'],'records':[{'id':'row'+str(i),'kind':'order','businessDate':'2026-09-20','entityId':'sku-a','knownAt':'2026-09-30'} for i in range(41)]}
    class Inquiries(CanonicalQueryModel):
        async def call(self,messages,tools=None):
            if messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):return await super().call(messages,tools)
            self.calls+=1
            pages=[json.loads(m['content']) for m in messages if m['role']=='tool']
            if len(pages)<2:
                assert tools
                return {'role':'assistant','content':None,'tool_calls':[{'id':'page'+str(len(pages)),'type':'function','function':{'name':'read_frozen_records','arguments':json.dumps({'cursor':len(pages)*20})}}]},{'prompt_tokens':100,'completion_tokens':100,'total_tokens':200}
            assert tools is None and pages[1]['records'][0]['id']=='row20' and pages[1]['total']==41
            return {'role':'assistant','content':json.dumps(answer())},{'prompt_tokens':100,'completion_tokens':100,'total_tokens':200}
    r,_=execute(tmp_path,request,Inquiries());assert r['status']=='completed',r
    assert sum(t['tool']=='supplementary_inquiry' for t in r['result']['toolReads'])==2
    assert r['observability']['modelInvocations']==4


def test_canonical_simulate_uses_actual_frozen_typed_results(tmp_path):
    request=job('generation',question='推演已确认方案',mode='joint')
    context={'generationId':'g','scenarios':[{'id':'s','name':'已确认到货','actions':[]}],'results':[{'id':'s','inputGeneration':'g','version':'calc-v1','status':'calculated','totals':{'contributionMarginCents':100},'feasibility':{'status':'feasible','reasons':[]}}],'recommendation':{'scenarioId':'s','reason':'已确认候选'}}
    request['envelope']['operatingBasis']['scenarioContext']=context
    r,_=execute(tmp_path,request,CanonicalQueryModel());assert r['status']=='completed',r
    assert r['result']['businessAssessment']['priorityAction']['scenarioComparison']==context
    assert r['result']['businessAssessment']['priorityAction']['selectedIsExecuted'] is False


def test_uncompared_action_never_claims_rejected_by_confirmed_objective():
    from neo_agent.assessment_conversion import priority_action
    env={'snapshot':{},'operatingBasis':{'profile':{'industry':'hotel'},'period':{'start':'2020-01-01','end':'2020-01-02'},'scenarioContext':{'results':[{'id':'s','status':'insufficient','feasibility':{'status':'unconfirmed','reasons':[]}}],'recommendation':{'scenarioId':None,'reason':'缺少可比较方案'}}}}
    result=priority_action({'action':'核对'}, {'conclusion':'待确认'}, {'asOf':'2020-01-02','operatingVersion':'v'}, env,[],[])
    assert result['rejectionReasons'][0]['status']=='not_comparable'
    assert result['rejectionReasons'][0]['reason']=='缺少可比较方案'
    assert result['reviewWindow']['start'] is None and result['reviewWindow']['status']=='pending_confirmation'
    assert result['observationMetrics']['unit']=='房晚'


def test_snapshot_requested_full_record_reaches_model_with_source_id(tmp_path):
    request=job('snapshot',question='诊断订单明细',mode='conversion')
    original=next(r for r in request['envelope']['facts'] if r['kind']=='orders')
    request['envelope']['facts']=[{**copy.deepcopy(original),'id':f'row-{i:03d}'} for i in range(65)]
    class Detail(QueryModel):
        async def call(self,messages,tools=None):
            if messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):return await super().call(messages,tools)
            raw=next((json.loads(m['content'])['result'] for m in messages if m['role']=='tool' and '"recordsPage"' in m['content']),None)
            if raw is None:
                return {'role':'assistant','content':None,'tool_calls':[{'id':'detail','type':'function','function':{'name':'read_business','arguments':json.dumps({'section':'conversion','recordId':'row-064'})}}]},{'total_tokens':100}
            assert raw['recordsPage']['total']==1 and len(raw['facts'])==1
            return {'role':'assistant','content':json.dumps({'conclusion':'需核对该笔记录的业务条件','evidenceIds':[raw['facts'][0]['id']],'alternatives':[],'gaps':['实际经营条件待确认'],'candidates':[],'followups':[]})},{'total_tokens':100}
    r,_=execute(tmp_path,request,Detail());assert r['status']=='completed',(r['error'],r['observability'])
    assert r['result']['finding']['evidenceIds']==['row-064']

@pytest.mark.parametrize('text',['公司确认该政策适用本企业','没有任何履约风险','先补货就能确保利润增长','需要说明的是订单证明新增客户增长'])
def test_definitive_statements_are_not_exempted_by_confirmation_or_negation(text):
    verdict={'claims':[{'index':0,'status':'insufficient','references':[],'applicability':'尚未验证','counterevidence':[],'gaps':['缺依据']}]}
    with pytest.raises(ExecutionError):validate_claims(verdict,[{'path':'finding','statement':text}],{}, {})

@pytest.mark.parametrize('text',['假设：供给约束可能影响订单','待核验：该政策是否适用','请确认现金预算是否可用','请业务确认安全线口径与补货计划','向业务确认安全线口径与补货计划','若业务确认缺口影响承接，可优先排序'])
def test_explicit_hypothesis_or_verification_request_may_retain_insufficient(text):
    verdict={'claims':[{'index':0,'status':'insufficient','references':[],'applicability':'尚未验证','counterevidence':[],'gaps':['缺依据']}]}
    assert validate_claims(verdict,[{'path':'finding','statement':text}],{}, {})[0]['status']=='insufficient'

@pytest.mark.parametrize('error', ['provider','timeout','budget'])
def test_unverified_runtime_draft_is_internal_on_every_checker_failure(tmp_path,error):
    from neo_agent.providers import ProviderError
    class Interrupted(CanonicalQueryModel):
        async def call(self,messages,tools=None):
            if messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
                if error=='provider':raise ProviderError('模型服务暂不可用')
                raise ExecutionError('校验无法完成','RUN_TIMEOUT' if error=='timeout' else 'TOKEN_BUDGET')
            return await super().call(messages,tools)
    r,_=execute(tmp_path,job('generation'),Interrupted())
    assert r['status']=='failed' and r['result']['semanticValidation']['status']=='pending'
    assert r['result']['finding'] is None and r['result']['specialists']=={} and r['result']['operatingReviews']=={}
    assert r['result']['verifiedMetrics']['paidOrders']['value']==20
    assert 'businessAssessment' not in r['result']

@pytest.mark.parametrize('field',['title','decisionGate','why','check','nextVerification','relevance','nextStep'])
def test_public_schema_string_fields_all_enter_gate(field):
    from neo_agent.claim_support import statements
    text='补货确保利润增长'
    entries=statements({'finding':{'homeDecision':{'jointReview':{'nextAction':{field:text}}}}})
    assert entries[0]['statement']==text and entries[0]['path'].endswith(field)


def test_unsupported_action_title_never_reaches_saved_assessment_or_projection(tmp_path):
    class InvalidTitle(CanonicalQueryModel):
        async def call(self,messages,tools=None):
            response,usage=await super().call(messages,tools)
            if not messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
                v=json.loads(response['content']);v['nextAction']['title']='补货确保利润增长';response['content']=json.dumps(v)
            return response,usage
    r,_=execute(tmp_path,job('generation'),InvalidTitle())
    assert r['status']=='failed' and r['observability']['errorCode']=='CLAIM_NOT_SUPPORTED'
    assert r['result']['semanticValidation']['status']=='rejected'
    assert not r['result'].get('businessAssessment') and not r['result'].get('operatingReviews')


def test_scoped_ts_calculation_reaches_tool_grounding_and_saved_claim(tmp_path):
    import subprocess
    from pathlib import Path
    script="""
import {buildBusinessState} from './lib/business-state.ts';
import {scopedOperatingReviewBasis} from './server/business-review-basis.ts';
const profile={industry:'ecommerce',timezone:'Asia/Shanghai',name:'test',region:'CN',horizonDays:7,objective:'contribution_margin',cashBudgetCents:null,expectedSources:[{sourceId:'erp',kinds:['order','expense','event']}],competitors:[]};
const coverage=['order','expense','event'].map(kind=>({kind,sourceId:'erp',start:'2026-09-01',end:'2026-09-30'}));
const rows=[['a1','a','online','2026-09-20',100],['a2','a','online','2026-09-21',300],['b1','b','offline','2026-09-21',900]].map(([id,entityId,channelId,businessDate,amountCents])=>({id,recordKey:id,sourceId:'erp',revision:1,knownAt:'2026-09-30',kind:'order',businessDate,entityId,channelId,customerId:id,orderId:id,entryType:'paid',quantity:1,amountCents,variableCostCents:0}));
const state=buildBusinessState({businessId:'b1',dataNature:'demo',profileVersion:'p',profile,asOf:'2026-09-30',knownAt:'2026-09-30',start:'2026-09-01',end:'2026-09-30'},rows,coverage);
const g={id:'g',version:'v',state,configuration:{},baseline:{status:'insufficient',totals:{},feasibility:{status:'unconfirmed'},limitations:[],assumptions:[]}};
console.log(JSON.stringify(scopedOperatingReviewBasis(g,'QUERY_TEST',{entityId:'a',channelId:'online',period:{start:'2026-09-20',end:'2026-09-21'}})));
"""
    basis=json.loads(subprocess.check_output(['node','--input-type=module','-e',script],cwd=Path(__file__).resolve().parents[2],text=True))
    scope={'entityId':'a','channelId':'online','period':{'start':'2026-09-20','end':'2026-09-21'}}
    b={**basis,'activeScope':scope}
    out=scoped_read(b,'read_diagnostics',{})
    assert out['current']['metrics']['netRevenueCents']['value']==300
    assert out['metricClaims']['diagnostic:change:netRevenueCents']['value']==200
    assert out['scope']==basis['metricScope']
    for override in [{'entityId':'b'},{'channelId':'offline'},{'start':'2026-09-19'}]:
        missing=scoped_read(b,'read_diagnostics',override)
        assert missing['status']=='unsupported' and missing['metricClaims']=={} and 'current' not in missing
    request=job('generation',question='诊断当前SKU变化',mode='conversion')
    request['envelope']['operatingBasis']={**basis,'interaction':{'question':request['question'],'role':'conversion'}}
    request['envelope']['conversation']={'active':scope}
    from test_operating_reviews import answer
    class Scoped(CanonicalQueryModel):
        async def call(self,messages,tools=None):
            if messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
                payload=json.loads(messages[1]['content'])
                assert payload['scope']['metricScope']==basis['metricScope']
                assert any(r['id']=='metric:diagnostic:change:netRevenueCents' and r['data']['value']==200 for r in payload['evidence'])
                return await super().call(messages,tools)
            pages=[json.loads(m['content']) for m in messages if m['role']=='tool']
            if not pages:return {'role':'assistant','content':None,'tool_calls':[{'id':'diag','type':'function','function':{'name':'read_diagnostics','arguments':'{}'}}]},{'total_tokens':100}
            assert pages[0]['metricClaims']['diagnostic:change:netRevenueCents']['value']==200
            v=answer();v['claims']=[{'metricKey':'diagnostic:change:netRevenueCents','value':200}];v['evidenceIds']=['metric:diagnostic:change:netRevenueCents']
            return {'role':'assistant','content':json.dumps(v)},{'total_tokens':100}
    r,_=execute(tmp_path,request,Scoped());assert r['status']=='completed',r['error']
    assert r['result']['businessAssessment']['scope']['metricScope']==basis['metricScope']
    assert r['result']['operatingReviews']['conversion']['claims'][0]['value']==200


def test_home_status_object_and_assumption_notes_are_public_prose_not_metadata():
    from neo_agent.claim_support import statements
    values=statements({'finding':{'homeDecision':{'jointReview':{'status':{'title':'利润已经有保障'}}},'proposedAssumptions':{'adjustments':[{'assumption':{'source':'user_assumption','note':'公司确认该政策适用本企业'}}]}}})
    assert {v['statement'] for v in values}=={'利润已经有保障','公司确认该政策适用本企业'}


def test_query_semantic_catalog_keeps_relevant_unknown_and_counter_sources():
    from neo_agent.claim_support import evidence_catalog
    j=job(question='查询支付订单与退款数量')
    state={'job':j,'runtimePlan':plan_task(j),'calculationContext':{'conversion':{'paidOrders':223,'refundOrders':19,'netRevenueCents':12345,'variableCostCents':None,'metricStatus':{'paidOrders':{'status':'observed'},'refundOrders':{'status':'observed'},'netRevenueCents':{'status':'observed'},'variableCostCents':{'status':'missing'}}}}}
    scope={'periodStart':'2026-07-06','periodEnd':'2026-08-30','productId':None}
    reads=[{'queryEvidence':{'scope':scope,'matchingFactIdsHash':'h','factCount':42,'method':'original'}},{'queryEvidence':{'scope':{**scope,'start':scope['periodStart'],'end':scope['periodEnd']},'matchingFactIdsHash':'h','factCount':42,'method':'original'}}]
    draft={'finding':{'conclusion':'支付订单223笔，退款19笔'},'toolReads':reads,'marketEvidence':[{'id':'counter','verificationStatus':'source_read','content':'与当前猜想矛盾的已读原文'}]}
    catalog=evidence_catalog(state,draft)
    assert {'metric:conversion:paidOrders','metric:conversion:refundOrders','metric:conversion:variableCostCents','counter:paragraph:0'}<=set(catalog)
    assert 'metric:conversion:netRevenueCents' not in catalog
    assert len([r for r in catalog.values() if r['kind']=='query'])==1


def test_query_semantic_catalog_includes_rows_from_completed_business_read():
    from neo_agent.business_tools import read_fact_view
    from neo_agent.claim_support import evidence_catalog
    request=job(question='各渠道投放费用分别是多少',mode='market')
    args={'section':'market','grain':'period'}
    computed=read_fact_view(request['envelope'],'market',args)
    read={'tool':'read_business','status':'completed','phase':'investigation',
          'arguments':args,'queryEvidence':computed['queryEvidence'],'evidenceIds':computed['scopedEvidenceIds']}
    state={'job':request,'runtimePlan':plan_task(request),'calculationContext':{}}
    catalog=evidence_catalog(state,{'toolReads':[read]})
    rows=[json.loads(item['exact']) for item in catalog.values()
          if item['kind']=='calculation' and isinstance(item.get('exact'),str)]
    assert any(isinstance(row,list) and row and 'channel' in row[0] and 'spendCents' in row[0] for row in rows)


def test_in_transit_catalog_includes_completed_supply_domain_details():
    from neo_agent.business_tools import read_fact_view
    from neo_agent.claim_support import evidence_catalog
    request=job(question='查看在途',mode='supply')
    env=request['envelope'];snapshot=env['snapshot']
    env['facts']=[{'id':'stock-1','kind':'inventory','fact':{
        'business_id':snapshot['businessId'],'data_nature':snapshot['dataNature'],
        'business_date':snapshot['asOf'],'product_id':'sim-X2','sku_id':'sim-X2-S1',
        'warehouse_id':'sim-W-east','sellable_units':2,'in_transit_units':1,
        'inventory_cost_cents':100,'safety_units':1}}]
    env['domain']={'skus':[{'id':'sim-X2-S1','name':'旗舰跑步机 X2 模拟规格1'}],
                   'warehouses':[{'id':'sim-W-east','name':'模拟东仓'}],
                   'arrivals':[{'id':'plan-1','skuId':'sim-X2-S1','warehouseId':'sim-W-east',
                                'date':'2026-09-28','units':1,'status':'planned'}]}
    args={'section':'supply','grain':'period'};computed=read_fact_view(env,'supply',args)
    read={'tool':'read_business','status':'completed','phase':'investigation',
          'arguments':args,'queryEvidence':computed['queryEvidence']}
    state={'job':request,'runtimePlan':plan_task(request),'calculationContext':{}}
    catalog=evidence_catalog(state,{'toolReads':[read]})
    domain=next(json.loads(item['exact']) for item in catalog.values()
                if item['kind']=='completed_supply_domain')
    assert domain['skus']==[{'id':'sim-X2-S1','name':'旗舰跑步机 X2 模拟规格1'}]
    assert domain['warehouses']==[{'id':'sim-W-east','name':'模拟东仓'}]
    assert domain['arrivals']==[{'date':'2026-09-28','id':'plan-1','skuId':'sim-X2-S1',
                                 'status':'planned','units':1,'warehouseId':'sim-W-east'}]


def test_market_query_returns_deterministic_channel_totals():
    result=query_facts(job()['envelope'],'market',{'grain':'period'})
    channels=result['channelAggregates']
    assert channels and all('productId' not in row for row in channels)
    assert sum(row['spendCents'] for row in channels)==result['totals']['spendCents']
    assert len({row['channel'] for row in channels})==len(channels)


def test_compact_semantic_refs_restore_full_exact_scope_and_partial_paragraph_location():
    from neo_agent.claim_support import decode_compact_claims
    catalog={'metric:paidOrders':{'id':'metric:paidOrders','kind':'metric','exact':'{"value":20}'},'doc:paragraph:0':{'id':'doc:paragraph:0','kind':'paragraph','exact':'前提：只适用小型企业。限制：不适用于其他企业。','sourceId':'doc'}}
    scope={'businessId':'b','inputId':'s'}
    value,resolved=decode_compact_claims({'claims':[{'i':0,'s':'S','r':[0,[1,3,10]],'c':[],'g':[]}]},catalog,scope,1)
    assert value['claims'][0]['references'][0]=={'id':'metric:paidOrders','quote':'{"value":20}'}
    ref=value['claims'][0]['references'][1];assert ref['quote']==catalog['doc:paragraph:0']['exact'][3:10]
    assert resolved[ref['id']]['locator']=={'start':3,'end':10,'unit':'unicode_codepoint','sourceId':'doc:paragraph:0'}
    assert resolved[ref['id']]['sourceExact']==catalog['doc:paragraph:0']['exact']
    assert json.loads(value['claims'][0]['applicability'])==scope


@pytest.mark.parametrize('value',[
 {'claims':[{'i':0,'s':'S','r':[99],'c':[],'g':[]}]},{'claims':[{'i':0,'s':'S','r':[True],'c':[],'g':[]}]},
 {'claims':[{'i':0,'s':'S','r':[[0,0,999]],'c':[],'g':[]}]},{'claims':[{'i':0,'s':'S','r':[0],'c':[],'g':[]}],'extra':1},
 {'claims':[[0,'S',[0],[],[],'extra']]},{'claims':[{'i':0,'s':'S','r':[0],'c':[],'g':[]},{'i':0,'s':'S','r':[0],'c':[],'g':[]}]},
 {'claims':[{'i':0,'s':'S','r':[0],'c':[99],'g':[]}]},{'claims':[{'i':0,'s':'S','r':[0],'c':[],'g':[{'invented':'quote'}]}]}
])
def test_compact_semantic_schema_rejects_unknown_refs_ranges_and_extra_fields(value):
    from neo_agent.claim_support import decode_compact_claims
    with pytest.raises(ValueError):decode_compact_claims(value,{'r':{'id':'r','kind':'paragraph','exact':'actual'}},{},1)


def test_compact_semantic_counterevidence_is_resolved_and_contradiction_still_blocks():
    from neo_agent.claim_support import decode_compact_claims
    catalog={'r':{'id':'r','kind':'paragraph','exact':'不适用'}}
    value,resolved=decode_compact_claims({'claims':[{'i':0,'s':'C','r':[],'c':[0],'g':['范围不适用']}]},catalog,{'businessId':'b'},1)
    assert value['claims'][0]['counterevidence'][0]['exact']=='不适用'
    with pytest.raises(ExecutionError,match='矛盾'):validate_claims(value,[{'statement':'本企业已符合政策'}],resolved,{'businessId':'b'})


@pytest.mark.parametrize('repair_succeeds',[True,False])
def test_semantic_compact_truncation_repairs_with_all_statements_and_original_sources(tmp_path,repair_succeeds):
    from semantic_model_stub import semantic_response
    class Truncated(QueryModel):
        checks=0
        async def call(self,messages,tools=None):
            if not messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):return await super().call(messages,tools)
            self.calls+=1;self.checks+=1
            payload=json.loads(messages[1]['content']);response=semantic_response(messages)
            assert len(response['content'].encode())<1200 # conservative byte cap; no tokenizer assumption
            if self.checks==1:
                self.original=payload;response['content']=response['content'][:-5]
            else:
                assert payload==self.original and len(messages)==3
                assert all(m['role']!='assistant' for m in messages)
                if not repair_succeeds:response['content']=response['content'][:-5]
            return response,{'prompt_tokens':1000,'completion_tokens':200,'total_tokens':1200}
    model=Truncated();r,_=execute(tmp_path,job(),model)
    assert model.calls==3 and model.checks==2,r
    if not repair_succeeds:
        assert r['status']=='failed' and r['observability']['errorCode']=='CLAIM_VALIDATION_FAILED'
        assert r['result']['partial'] and r['result']['finding'] is None and not r['result'].get('businessAssessment')
        return
    assert r['status']=='completed',r
    claims=r['result']['businessAssessment']['claims']
    assert claims and all(c['supportingReferences'][0]['exact'] for c in claims)


def test_only_successfully_presented_tool_metadata_enters_semantic_catalog(tmp_path):
    from neo_agent.claim_support import evidence_catalog
    request=job(question='查询支付订单与客户身份记录');request['envelope']['snapshot']['limitations']=['退款计入实际发生日，可能使该期净成交额为负。']
    request['envelope']['domain']['customerIdentities']=[]
    r,_=execute(tmp_path,request,QueryModel());assert r['status']=='completed',r
    reads=r['result']['toolReads'];sources=[s for read in reads for s in read.get('semanticSources',[])]
    assert any('退款计入实际发生日' in s['exact'] for s in sources)
    assert any(s['locator']['path']=='units.orders' for s in sources)
    assert any(s['locator']['path']=='domain.customerIdentities' and '"recordCount":0' in s['exact'] for s in sources)
    assert not any(s['locator']['path'].startswith('businessRules') for s in sources) # QUERY did not present those rules
    state={'job':request,'runtimePlan':plan_task(request),'calculationContext':{}}
    bad={'toolReads':[{'tool':'describe_business','status':'failed','semanticSources':[{'id':'invented','exact':'已确认企业政策','locator':{}}]}]}
    assert 'invented' not in evidence_catalog(state,bad)


def test_legacy_exact_quote_claim_remains_readable_without_compact_reinterpretation():
    old={'claims':[{'index':0,'status':'supported','references':[{'id':'r','quote':'原始事实'}],'applicability':'旧冻结期间','counterevidence':[],'gaps':[]}]}
    claims=validate_claims(old,[{'statement':'已有原始事实'}],{'r':{'id':'r','kind':'frozen_record','exact':'原始事实'}},{'inputId':'old'})
    assert claims[0]['applicability']=='旧冻结期间' and claims[0]['supportingReferences'][0]['exact']=='原始事实'


@pytest.mark.parametrize('incorrect_absence',[True,False])
def test_zero_identity_table_cannot_erase_available_customer_journey(tmp_path,incorrect_absence):
    request=job();env=request['envelope'];env['domain']['customerIdentities']=[]
    env['customerJourney']={'version':'customer-journey-v1','evidenceId':'journey','period':{'start':env['snapshot']['periodStart'],'end':env['snapshot']['periodEnd'],'counts':{'A1':234,'A2':215,'A3':182,'A4':143},'transitions':[{'from':'A3','to':'A4','rate':0.68}]}}
    class Identity(QueryModel):
        async def call(self,messages,tools=None):
            response,usage=await super().call(messages,tools)
            if messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
                data=json.loads(messages[1]['content']);assert any(e.get('field')=='availableDerivedViews.customerJourney' and '143' in json.dumps(e['data']) for e in data['evidence'])
            elif not response.get('tool_calls'):
                v=json.loads(response['content']);v['gaps']=['客户身份记录为0，无法计算客户转化率' if incorrect_absence else '仅凭订单笔数无法计算客户转化率'];response['content']=json.dumps(v)
            return response,usage
    r,_=execute(tmp_path,request,Identity())
    if incorrect_absence:
        assert r['status']=='failed' and r['observability']['errorCode']=='CLAIM_NOT_SUPPORTED'
        assert r['result']['finding'] is None and r['result']['partial']
    else:assert r['status']=='completed',r


def test_conversion_explain_reads_and_semantically_catalogs_customer_journey(tmp_path):
    from neo_agent.claim_support import evidence_catalog
    request=job(question='分析为什么A1到A2转化率这么低');env=request['envelope']
    journey={'version':'customer-journey-v1','evidenceId':'journey','period':{'start':env['snapshot']['periodStart'],'end':env['snapshot']['periodEnd'],'counts':{'A1':234,'A2':215},'transitions':[{'from':'A1','to':'A2','matureCustomers':233,'convertedCustomers':136,'rate':136/233}]},'recent':{'start':'2026-08-24','end':'2026-09-20','transitions':[{'from':'A1','to':'A2','rate':.683}]},'previous':{'start':'2026-07-27','end':'2026-08-23','transitions':[{'from':'A1','to':'A2','rate':.685}]},'weekly':[{'mustNotReachModel':True}]}
    env['customerJourney']=journey;presented=[];semantic_sizes=[]
    class JourneyModel(QueryModel):
        async def call(self,messages,tools=None):
            if not messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
                assert '优先回答recent并与previous同口径比较' in messages[0]['content']
                assert '<ANSWER_WORKFLOW>' in messages[0]['content']
                assert '不向用户展开思维链或查询日志' in messages[0]['content']
                assert '本轮已读资料未提供' in messages[0]['content']
            else:
                assert '冻结记录可以支持对已观察现象的核查顺序' in messages[0]['content']
                semantic_sizes.append(len(messages[1]['content'].encode()))
            for message in messages:
                if message.get('role')!='tool':continue
                result=json.loads(message['content']).get('result',{})
                if isinstance(result,dict) and result.get('customerJourney'):presented.append(result['customerJourney'])
            response,usage=await super().call(messages,tools)
            if response.get('content') and not messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
                response['content']=json.dumps({'answerIntent':'判断A1到A2近期转化是否偏低及原因','conclusion':'A1到A2近期转化并不明显偏低，原因仍待核查。','basis':['近期转化率68.3%，上一窗口68.5%'],'nextStep':'核对客户未承接的业务原因','evidenceIds':['ev1'],'alternatives':[],'gaps':['现有资料未记录成因'],'candidates':['重复的旧建议不应进入最终回答'],'followups':[]},ensure_ascii=False)
            return response,usage
    result,_=execute(tmp_path,request,JourneyModel())
    assert result['status']=='completed',result
    assert result['result']['finding']['answerIntent'].startswith('判断A1到A2')
    assert result['result']['finding']['basis']==['近期转化率68.3%，上一窗口68.5%']
    assert result['result']['finding']['nextStep']=='核对客户未承接的业务原因'
    assert result['result']['finding']['candidates']==[]
    assert presented and presented[0]['period']['transitions'][0]['rate']==136/233
    assert 'weekly' not in presented[0]
    state={'job':request,'runtimePlan':plan_task(request),'calculationContext':{},'diagnostics':{'customerJourney':journey}}
    journey_ref=json.loads(evidence_catalog(state,{'toolReads':[]})['diagnostic:customerJourney']['exact'])
    assert journey_ref['recent']['transitions'][0]['rate']==.683 and 'weekly' not in journey_ref
    assert semantic_sizes and max(semantic_sizes)<20000
    from neo_agent.business_tools import describe_business,scoped_customer_journey
    env.setdefault('conversation',{}).setdefault('active',{})['period']={'start':'2026-08-24','end':'2026-09-20'}
    view=describe_business(env)['availableDerivedViews']['customerJourney']
    assert view['matchesCurrentScope'] is True and view['matchedWindow']=='recent'
    scoped=scoped_customer_journey(journey,'2026-08-24','2026-09-20')
    assert scoped['requestedWindow']=='recent' and scoped['recent']['transitions'][0]['rate']==.683 and scoped['previous']['transitions'][0]['rate']==.685


def test_checker_rejects_duplicate_keys_including_contradicted_then_supported():
    from neo_agent.claim_support import strict_json_loads
    for raw in ['{"claims":[{"i":0,"s":"C","r":[],"c":[0],"g":["证据相反"]}],"claims":[{"i":0,"s":"S","r":[0],"c":[],"g":[]}]}','{"claims":[{"i":0,"s":"C","s":"S","r":[0],"c":[],"g":[]}]}']:
        with pytest.raises(ValueError,match='重复'):strict_json_loads(raw)


def test_query_assessment_has_no_synthetic_decision_prose(tmp_path):
    from neo_agent.claim_support import statements
    r,_=execute(tmp_path,job(),QueryModel());assert r['status']=='completed',r
    a=r['result']['businessAssessment']
    assert a['confirmations']==[] and a['problems']==[] and a['projections']['professional']=={}
    assert not any('经营目标' in x or '经营约束' in x for x in a['reviewConditions'])
    text=' '.join(x['statement'] for x in statements({**r['result'],**a}))
    assert not any(x in text for x in ['客户转化判断','可能改变经营判断','核对相关来源与业务口径','conversion'])


def test_professional_projection_title_is_a_ui_label_not_a_business_claim():
    from neo_agent.claim_support import statements
    items=statements({'projections':{'professional':{'supply':{'title':'供给判断','summary':'东仓一个规格可售为0'}}}})
    assert [item['statement'] for item in items]==['东仓一个规格可售为0']


def test_legacy_metric_catalog_distinguishes_order_counts_from_unit_counts():
    from neo_agent.claim_support import evidence_catalog
    j=job();values={'paidOrders':223,'refundOrders':19,'paidUnits':240,'refundUnits':21}
    state={'job':j,'runtimePlan':plan_task(j),'calculationContext':{'conversion':{**values,'metricStatus':{k:{'status':'observed'} for k in values}}}}
    catalog=evidence_catalog(state,{'finding':{'conclusion':'支付订单223笔、退款19笔，支付240件、退款21件'}})
    for key,value in values.items():
        ref=catalog['metric:conversion:'+key];exact=json.loads(ref['exact'])
        assert exact['value']==value and exact['unit']==('笔' if key.endswith('Orders') else '件')
        assert ref['label'] in ('支付订单笔数','退款订单笔数','支付商品件数','退款商品件数')


@pytest.mark.parametrize('recorded',[True,False])
def test_recorded_malformed_and_duplicate_checker_replies_cannot_publish(tmp_path,recorded):
    from pathlib import Path
    fixture=json.loads((Path(__file__).parent/'fixtures'/'semantic-wire-failures.json').read_text())
    class Malformed(QueryModel):
        checks=0
        async def call(self,messages,tools=None):
            if not messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):return await super().call(messages,tools)
            self.calls+=1;self.checks+=1
            if self.checks==2:
                assert len(messages)==3 and '输出无效' in messages[-1]['content']
                if not recorded:assert '重复' in messages[-1]['content']
            if recorded:return fixture['responses'][self.checks]['message'],{'prompt_tokens':1000,'completion_tokens':200,'total_tokens':1200}
            # Never choose the last S over the first C, even inside a bounded repair.
            return {'role':'assistant','content':'{"claims":[{"i":0,"s":"C","r":[],"c":[0],"g":["证据相反"]}],"claims":[{"i":0,"s":"S","r":[0],"c":[],"g":[]}]}'},{'total_tokens':100}
    model=Malformed();r,_=execute(tmp_path,job(),model)
    assert r['status']=='failed' and r['observability']['errorCode']=='CLAIM_VALIDATION_FAILED',r
    assert model.calls==3 and r['result']['finding'] is None and not r['result'].get('businessAssessment')


@pytest.mark.parametrize('row',[
 {'i':0,'s':'S','r':[0],'c':[]},
 {'i':0,'s':'S','r':[0],'c':[],'g':'missing'},
 {'i':0,'s':'S','r':[0],'c':[],'g':[],'extra':[]},
 [0,'S',[0],[],[]]
])
def test_named_checker_rows_require_all_fields_and_array_types(row):
    from neo_agent.claim_support import decode_compact_claims
    with pytest.raises(ValueError):decode_compact_claims({'claims':[row]},{'r':{'id':'r','kind':'metric','exact':'20'}},{},1)


def test_query_keeps_candidate_words_without_generating_action_workflow(tmp_path):
    r,_=execute(tmp_path,job(),QueryModel());assert r['status']=='completed',r
    a=r['result']['businessAssessment'];assert r['result']['finding']
    assert a['priorityAction'] is None
    assert a['candidates'][0]['action']=='核实库存' and r['result']['finding']['candidates']==['核实库存']


@pytest.mark.parametrize('statement,key,value,valid',[
 ('支付240笔','paidUnits',240,False),('退款21笔','refundUnits',21,False),
 ('支付223笔','paidOrders',223,True),('退款19笔','refundOrders',19,True)
])
def test_checker_cannot_approve_order_counts_bound_to_unit_metrics(statement,key,value,valid):
    ref={'id':'metric:conversion:'+key,'kind':'metric','exact':json.dumps({'value':value,'unit':'笔' if key.endswith('Orders') else '件'}),'value':value}
    verdict={'claims':[{'index':0,'status':'supported','references':[{'id':ref['id'],'quote':ref['exact']}],'applicability':'本期','counterevidence':[],'gaps':[]}]}
    if valid:assert validate_claims(verdict,[{'statement':statement}],{ref['id']:ref},{})[0]['status']=='supported'
    else:
        with pytest.raises(ExecutionError,match='笔数'):validate_claims(verdict,[{'statement':statement}],{ref['id']:ref},{})


def test_structured_semantic_wire_preserves_data_and_paragraphs_without_escaped_json_copies():
    from neo_agent.claim_support import evidence_wire
    catalog={'m':{'id':'m','kind':'metric','exact':'{"value":223,"unit":"笔"}'},'q':{'id':'q','kind':'query','exact':'{"scope":{"productId":"a"},"matchingFactIdsHash":"opaque","factCount":12}'},'p':{'id':'p','kind':'paragraph','exact':'原文含"引号"和\\字符。'}}
    wire,scopes=evidence_wire(catalog)
    assert wire[0]['data']=={'value':223,'unit':'笔'} and wire[1]['scopeIndex']==0 and scopes==[{'productId':'a'}]
    assert wire[2]['exact']==catalog['p']['exact'] and catalog['q']['exact'].find('opaque')>=0
    assert 'matchingFactIdsHash' not in wire[1]['data']


@pytest.mark.parametrize('insufficient',[False,True])
def test_actual_fourth_answer_complete_checker_payload_fits_unchanged_query_cap(monkeypatch,insufficient):
    from pathlib import Path
    import neo_agent.claim_support as support
    from neo_agent.execution import reserve_input
    fixture=json.loads((Path(__file__).parent/'fixtures'/'semantic-query-payload.json').read_text())
    draft={'finding':support.strict_json_loads(fixture['response']['content'])}
    assert len(support.statements(draft))==8 # All original alternatives, gaps and candidates, unchanged.
    monkeypatch.setattr(support,'evidence_catalog',lambda state,draft:fixture['catalog'])
    class Checker:
        async def call(self,messages,tools=None):
            reserve,_,_=reserve_input(messages,tools,[])
            assert fixture['usage']['total_tokens']==2831
            assert 2831+reserve+1200<=12000
            payload=json.loads(messages[1]['content']);ev=payload['evidence']
            assert len(payload['statements'])==8
            def metric(key):return next(e['i'] for e in ev if e.get('id','').endswith(':'+key))
            def field(key):return next(e['i'] for e in ev if e.get('field')==key)
            assert ev[field('availableDerivedViews.customerJourney')]['data']['period']['counts']['A4']==143
            assert ev[field('domain.customerIdentities')]['data']['recordCount']==0
            refs=[[metric('paidOrders'),metric('refundOrders')],[metric('paidUnits'),metric('refundUnits')],
                  [field('units.orders'),field('units.quantity')],[field('availableDerivedViews.customerJourney')],
                  [metric('netRevenueCents'),field('limitations.4')],[field('detailPolicy.')],
                  [metric('paidOrders'),metric('refundOrders')],[metric('paidOrders')]]
            # Explicit transport substitute: this is not a claim of provider semantic accuracy.
            raw=json.dumps({'claims':[{'i':i,'s':'I' if insufficient and i==4 else 'S','r':r,'c':[],
                'g':['未证实退款金额未单列'] if insufficient and i==4 else []} for i,r in enumerate(refs)]},ensure_ascii=False,separators=(',',':'))
            assert len(raw.encode())<1200
            return {'role':'assistant','content':raw},{'total_tokens':2000}
    async def run():return await support.check_claim_support({'scope':fixture['scope']},draft,Checker())
    if insufficient:
        with pytest.raises(ExecutionError,match='依据不足'):asyncio.run(run())
    else:
        claims,_=asyncio.run(run());assert len(claims)==8
        for c in claims:
            assert c['scope']==fixture['scope']
            for ref in c['supportingReferences']:assert ref==fixture['catalog'][ref['id']]


def test_order_unit_guard_checks_each_number_even_when_both_metric_types_are_cited():
    refs=[{'id':'metric:conversion:'+key,'kind':'metric','exact':json.dumps({'value':value,'unit':unit})}
          for key,value,unit in [('paidOrders',223,'笔'),('paidUnits',240,'件')]]
    verdict={'claims':[{'index':0,'status':'supported','references':[{'id':r['id'],'quote':r['exact']} for r in refs],
                       'applicability':'本期','counterevidence':[],'gaps':[]}]}
    catalog={r['id']:r for r in refs}
    assert validate_claims(verdict,[{'statement':'支付订单223笔，支付商品240件'}],catalog,{})
    with pytest.raises(ExecutionError,match='笔数'):
        validate_claims(verdict,[{'statement':'支付240笔'}],catalog,{})


def test_order_quantity_query_only_delivers_question_metrics_and_tracks_read_coverage(tmp_path):
    class Capture(QueryModel):
        async def call(self,messages,tools=None):
            if not messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
                payload=' '.join(m['content'] for m in messages if m['role']=='tool')
                assert 'behaviorCounts' not in payload and 'recordCount' not in payload
                assert 'netRevenue' not in payload and 'A1' not in payload
            return await super().call(messages,tools)
    r,_=execute(tmp_path,job(question='查询支付订单与退款数量'),Capture())
    assert r['status']=='completed',r
    read=next(x for x in r['result']['toolReads'] if x['tool']=='read_business' and x.get('readCoverage'))
    c=read['readCoverage']
    assert c['delivered']=={'periodTotals':True,'weeklyAggregates':False,'channelAggregates':False,'records':False}
    assert set(c['metricKeys'])=={'paidOrders','refundOrders','paidUnits','refundUnits'}
    assert c['availabilityConclusion']=='not_assessed'
    assert any(x['locator']['path']=='readCoverage' for x in read['semanticSources'])


@pytest.mark.parametrize('statement,valid',[
 ('退款订单的按周/渠道明细未在本轮读取范围',True),
 ('库里没有退款订单的按周渠道明细',False),
 ('退款订单的按周渠道明细不存在',False)
])
def test_delivery_coverage_is_not_evidence_of_missing_database_detail(statement,valid):
    ref={'id':'tool:coverage','kind':'tool_metadata','locator':{'path':'readCoverage'},
         'exact':json.dumps({'readCoverage':{'delivered':{'weeklyAggregates':False,'channelAggregates':False},'availabilityConclusion':'not_assessed'}})}
    v={'claims':[{'index':0,'status':'supported','references':[{'id':ref['id'],'quote':ref['exact']}],
                 'applicability':'本轮投递范围','counterevidence':[],'gaps':[]}]}
    if valid:assert validate_claims(v,[{'statement':statement}],{ref['id']:ref},{})
    else:
        with pytest.raises(ExecutionError,match='投递'):validate_claims(v,[{'statement':statement}],{ref['id']:ref},{})


def test_actual_fifth_answer_read_gap_has_exact_delivery_source(monkeypatch):
    from pathlib import Path
    import neo_agent.claim_support as support
    from neo_agent.execution import reserve_input
    f=json.loads((Path(__file__).parent/'fixtures'/'semantic-read-coverage.json').read_text())
    draft={'finding':support.strict_json_loads(f['response']['content'])}
    assert draft['finding']['gaps']==['退款订单的按周/渠道明细未在本轮读取范围']
    assert support.strict_json_loads(f['recordedResponses'][1]['response']['content'])['claims'][-1]['s']=='I'
    monkeypatch.setattr(support,'evidence_catalog',lambda state,draft:f['catalog'])
    class Checker:
        async def call(self,messages,tools=None):
            reserve,_,_=reserve_input(messages,tools,[]);assert f['usage']['total_tokens']+reserve+1200<=12000
            p=json.loads(messages[1]['content']);e=p['evidence']
            def metric(key):return next(r['i'] for r in e if r.get('id','').endswith(':'+key))
            coverage=next(r for r in e if r.get('field')=='readCoverage')
            assert coverage['data']['delivered']['weeklyAggregates'] is False
            assert coverage['data']['delivered']['channelAggregates'] is False
            assert coverage['data']['calculated']['weeklyAggregates'] is True
            assert coverage['data']['calculated']['channelAggregates'] is True
            # Controlled transport verdict selects the new actual read source; no edited original verdict.
            refs=[[metric('paidOrders'),metric('refundOrders')],[metric('paidUnits'),metric('refundUnits')],
                  [next(r['i'] for r in e if '客户人数' in str(r.get('data')))], [coverage['i']]]
            return {'content':json.dumps({'claims':[{'i':i,'s':'S','r':v,'c':[],'g':[]} for i,v in enumerate(refs)]})},{'total_tokens':2000}
    claims,_=asyncio.run(support.check_claim_support({'scope':f['scope']},draft,Checker()))
    assert len(claims)==4 and claims[-1]['supportingReferences'][0]['locator']['path']=='readCoverage'
    assert claims[-1]['statement']==draft['finding']['gaps'][0]


@pytest.mark.parametrize('bad',[False,True])
def test_actual_queue_never_publishes_database_absence_from_delivery_coverage(tmp_path,bad):
    class Coverage(QueryModel):
        async def call(self,messages,tools=None):
            if messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
                p=json.loads(messages[1]['content']);index=next(e['i'] for e in p['evidence'] if e.get('field')=='readCoverage')
                return {'content':json.dumps({'claims':[{'i':i,'s':'S','r':[index],'c':[],'g':[]} for i,_ in enumerate(p['statements'])]})},{'total_tokens':100}
            response,usage=await super().call(messages,tools);v=json.loads(response['content'])
            v.update(conclusion='库里没有退款订单的按周渠道明细' if bad else '退款订单的按周/渠道明细未在本轮读取范围',gaps=[],candidates=[])
            response['content']=json.dumps(v);return response,usage
    r,q=execute(tmp_path,job(question='查询支付订单与退款数量'),Coverage())
    if bad:
        assert r['status']=='failed' and r['observability']['errorCode']=='CLAIM_NOT_SUPPORTED'
        assert q.observe(r['id'])['result']['finding'] is None
    else:assert r['status']=='completed',r


def test_count_query_selector_falls_back_for_unknown_or_mixed_requested_metrics():
    from neo_agent.agent import order_query_metrics
    assert order_query_metrics('查询支付订单与退款数量')=={'paidOrders','paidUnits','refundOrders','refundUnits'}
    assert order_query_metrics('查询支付订单与退款金额') is None
    assert order_query_metrics('查询支付订单与新增用户数量') is None


def test_count_query_delivers_only_count_definitions_but_keeps_full_limitations_for_gate(tmp_path):
    request=job(question='查询支付订单与退款数量')
    policy='退款计入实际发生日，可能使该期净成交额为负。'
    request['envelope']['snapshot']['limitations']=[policy,'库存不按渠道筛选。']
    class Capture(QueryModel):
        async def call(self,messages,tools=None):
            if not messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
                payload=' '.join(m['content'] for m in messages if m['role']=='tool')
                assert '退款计入实际发生日' in payload
                assert '净成交' not in payload and '库存不按渠道' not in payload
                assert '经营目标' not in messages[0]['content'] and '客户统计' not in messages[0]['content']
            return await super().call(messages,tools)
    r,_=execute(tmp_path,request,Capture());assert r['status']=='completed',r
    sources=[s for read in r['result']['toolReads'] for s in read.get('semanticSources',[])]
    assert any(policy in s['exact'] for s in sources)
    assert any('库存不按渠道筛选' in s['exact'] for s in sources)


def test_count_definition_excerpt_requires_exact_clause_and_mixed_query_keeps_full_view():
    from neo_agent.agent import query_metric_projection
    original={'limitations':['退款计入实际发生日，可能使该期净成交额为负。']}
    assert query_metric_projection('describe_business',original,'查询退款数量')['statisticsDefinitions']=={'refundDateBasis':'退款计入实际发生日'}
    assert query_metric_projection('describe_business',original,'查询退款金额')==original
    assert original['limitations']==['退款计入实际发生日，可能使该期净成交额为负。']
    other={'limitations':['退款计入实际发生日之前的月份。']}
    assert 'statisticsDefinitions' not in query_metric_projection('describe_business',other,'查询退款数量')


def test_actual_sixth_mixed_statement_remains_strict_assertion_not_blanket_possibility_exemption():
    from pathlib import Path
    from neo_agent.claim_support import strict_json_loads,statements
    f=json.loads((Path(__file__).parent/'fixtures'/'semantic-count-context.json').read_text())
    finding=strict_json_loads(f['responses'][0]['message']['content']);items=statements({'finding':finding})
    assert items[-1]['statement']=='退款按实际发生日计入，可能使该期净成交为负'
    assert items[-1]['statementType']=='assertion'
    verdict=strict_json_loads(f['responses'][1]['message']['content'])
    assert verdict['claims'][-1]['s']=='I'
    ref={'id':'r','kind':'tool_metadata','exact':'退款计入实际发生日，可能使该期净成交额为负。'}
    value={'claims':[{'index':0,'status':'insufficient','references':[{'id':'r','quote':ref['exact']}],
                     'applicability':'本期','counterevidence':[],'gaps':['未确认该期净成交实际为负']}]}
    with pytest.raises(ExecutionError,match='依据不足'):validate_claims(value,[items[-1]],{'r':ref},{})

def test_normal_conversion_statistics_period_count_query_stays_within_original_admission(tmp_path):
    from neo_agent.execution import reserve_input
    from neo_agent.agent import order_query_metrics
    question='当前统计期支付订单和退款分别有多少笔？'
    assert order_query_metrics(question)=={'paidOrders','paidUnits','refundOrders','refundUnits'}
    request=job(question=question);request['mode']='conversion'
    request['envelope']['customerJourney']={'version':'fixture-large-journey','period':{'start':'2026-09-01','end':'2026-09-30','counts':{},'transitions':[]},'weekly':[{'customers':list(range(1000))} for _ in range(24)]}
    request['envelope']['snapshot']['data']['weeks']=[{'start':'2026-09-01','end':'2026-09-07','events':{'A1':1000,'A2':800,'A3':400},'paidOrders':20} for _ in range(24)]
    class Capture(QueryModel):
        async def call(self,messages,tools=None):
            if not messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):
                count,_,_=reserve_input(messages,tools,[])
                assert count+1200<12000
                wire=json.dumps(messages,ensure_ascii=False)
                assert 'behaviorCounts' not in wire and 'customerJourney' not in wire
            return await super().call(messages,tools)
    r,model=execute(tmp_path,request,Capture());assert r['status']=='completed',r
    assert r['observability']['limits']['maxTokens'] is None


def test_duplicate_checker_metadata_shares_values_but_preserves_reference_and_scope():
    from neo_agent.claim_support import evidence_wire,decode_compact_claims
    exact=json.dumps({'0':'orders未覆盖完整期间，未知日期不当零。'},ensure_ascii=False)
    catalog={k:{'id':k,'kind':'tool_metadata','exact':exact,'locator':{'path':'limitations.0','scope':{'productId':k}}} for k in ['a','b']}
    wire,scopes=evidence_wire(catalog)
    assert wire[1]['sameDataAs']==0 and 'data' not in wire[1]
    assert wire[0]['scopeIndex']!=wire[1]['scopeIndex'] and len(scopes)==2
    decoded,_=decode_compact_claims({'claims':[{'i':0,'s':'S','r':[1],'c':[0],'g':[]}]},catalog,{},1)
    assert decoded['claims'][0]['references'][0]['id']=='b'
    assert decoded['claims'][0]['counterevidence'][0]['id']=='a'
    assert catalog['b']['exact']==exact
