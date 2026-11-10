import asyncio, json
import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from neo_agent.agent import AgentRuntime
from neo_agent.contracts import Finding, Job
from neo_agent.home_decision import full_section_read, validate_home_decision, home_context_view, home_business_view
from neo_agent.knowledge import catalog, business_knowledge
from test_engine import fixture

def inputs():
    env=fixture();data=catalog()
    env['homeDecisionContext']={'forecast':{'id':'forecast-home','totals':{'units':35}},'knowledgeDigest':data['digest']}
    block={'title':'先核查渠道贡献毛利','summary':'测试适配器，不代表真实模型判断','evidenceIds':['ev1']}
    home={'judgment':block,'action':{**block,'steps':['核对渠道费用和毛利']},'sections':dict.fromkeys(('conversion','supply','market'),block),'outlook':{'forecastId':'forecast-home','title':'维持现状经营承压','summary':'测试预测结论'},'knowledgeVersion':data['version'],'knowledgeRuleIds':['K01']}
    finding={'conclusion':'已核查经营数据，先复查渠道费用。','evidenceIds':['ev1'],'alternatives':[],'gaps':[],'candidates':[],'followups':[],'homeDecision':home}
    return env,finding

def test_home_null_root_fields_can_be_restored_without_discarding_extra_content():
    from neo_agent.home_decision import normalize_home_response
    _,finding=inputs()
    finding['homeDecision'].update(businessReview=None,marketWorkbench=None,operatingRecommendation=None)
    original=json.dumps(finding,ensure_ascii=False)
    fixed=json.loads(normalize_home_response(original))
    assert Finding.model_validate(fixed).homeDecision is not None
    for key in ('businessReview','marketWorkbench','operatingRecommendation'):
        assert key not in fixed['homeDecision'] and fixed[key] is None
    assert finding['homeDecision']['businessReview'] is None
    for key,value in [('businessReview',{'title':'unexpected content'}),('unknown',None)]:
        candidate=json.loads(original);candidate['homeDecision'][key]=value
        with pytest.raises(ValueError):Finding.model_validate_json(normalize_home_response(json.dumps(candidate)))
    conflict=json.loads(original);conflict['businessReview']={'title':'must not discard'}
    normalized=json.loads(normalize_home_response(json.dumps(conflict)))
    assert normalized['businessReview']==conflict['businessReview']
    assert 'businessReview' in normalized['homeDecision']

def test_home_contract_requires_actual_three_section_reads_and_known_references():
    env,finding=inputs();f=Finding.model_validate(finding)
    validate_home_decision(f,{'ev1'},env,{'conversion','supply','market'},{'K01'})
    for sections,rules,known in [({'conversion'},{'K01'},{'ev1'}),({'conversion','supply','market'},{'K02'},{'ev1'}),({'conversion','supply','market'},{'K01'},set())]:
        with pytest.raises(ValueError):validate_home_decision(f,known,env,sections,rules)
    env['homeDecisionContext']['forecast']['id']='another-baseline'
    with pytest.raises(ValueError,match='预测基线'):validate_home_decision(f,{'ev1'},env,{'conversion','supply','market'},{'K01'})

def test_full_scope_checks_and_no_forecast_contract():
    env,finding=inputs();s=env['snapshot']
    assert full_section_read({'section':'conversion'},s)
    assert not full_section_read({'productId':'P1'},s)
    assert not full_section_read({'periodStart':'1999-01-01'},s)
    env['homeDecisionContext']['forecast']=None;finding['homeDecision']['outlook']['forecastId']=None
    validate_home_decision(Finding.model_validate(finding),{'ev1'},env,{'conversion','supply','market'},{'K01'})

def test_prompt_projection_keeps_totals_coverage_and_immutable_original():
    forecast={'id':'f','totals':{'units':0,'contributionMarginCents':None},'weeks':[],'forecastCoverage':{'status':'partial'},'daily':[{'large':'detail'}],'limitations':['scope']}
    basis={'forecast':forecast};decision={'id':'choice','reason':'核实供给后再决定','selectedScenario':{**forecast,'daily':['large payload']*10000,'assumptions':{'arrivals':[]}}}
    source={'id':'source','url':'https://example.invalid','verificationStatus':'source_read','excerpt':'已读取原文摘要','content':'完整原文'*12000,'retrievedAt':'2026-10-06'}
    context={'forecasts':[forecast],'decisions':[decision],'marketEvidence':[source]};out=home_context_view(context,basis)
    assert out['homeDecisionContext']['forecast']['totals']==forecast['totals'];assert out['forecasts'][0]['forecastCoverage']==forecast['forecastCoverage']
    assert 'daily' not in out['forecasts'][0];assert 'daily' in forecast
    assert 'daily' not in out['decisions'][0]['selectedScenario'];assert out['decisions'][0]['reason']==decision['reason'];assert out['decisions'][0]['selectedScenario']['totals']==forecast['totals']
    assert len(json.dumps(out))<5000;assert len(context['decisions'][0]['selectedScenario']['daily'])==10000
    assert out['marketEvidence'][0]['excerpt']==source['excerpt'];assert out['marketEvidence'][0]['id']=='source';assert 'content' not in out['marketEvidence'][0];assert context['marketEvidence'][0]['content']==source['content']

def test_home_business_projection_preserves_every_week_value_null_status_and_page():
    row={'paidOrders':0,'netRevenueCents':12345,'spendCents':None,'metricStatus':{'spendCents':{'status':'partial','knownValueCents':300,'missingRows':1}},'behaviorCounts':{'A3':12},'matchingFactIdsHash':'audit'}
    value={'totals':row,'weeklyTotals':[{**row,'weekStart':str(i)} for i in range(24)],'productChannelAggregates':[{**row,'productId':str(i)} for i in range(60)],'aggregateCount':80,'nextAggregateOffset':60,'coverage':{'orders':'declared'},'evidenceIds':{'revenue':'ev1'}}
    out=home_business_view(value);assert len(out['weeklyTotals'])==24;assert len(out['productChannelAggregates'])==60;assert out['nextAggregateOffset']==60
    for r in [out['totals'],*out['weeklyTotals'],*out['productChannelAggregates']]:
        for k in ('paidOrders','netRevenueCents','spendCents','metricStatus','behaviorCounts'):assert r[k]==row[k]
    assert out['coverage']==value['coverage'];assert out['evidenceIds']==value['evidenceIds'];assert value['totals']['matchingFactIdsHash']=='audit'

@pytest.mark.parametrize('joint',[False,True])
def test_home_graph_requires_all_sections_and_saves_same_forecast_and_knowledge(tmp_path,joint):
    env,finding=joint_inputs() if joint else inputs()
    knowledge=business_knowledge(env,'orchestrator','首页经营判断')
    finding['homeDecision']['knowledgeRuleIds']=[knowledge['rules'][0]['id']]
    class Model:
        name='OFFLINE_HOME_TEST'
        async def call(self,messages,tools=None):
            names={t['function']['name'] for t in tools or []}
            assert not names & {'forecast','simulate_scenario','search_market'}
            if not any(m['role']=='tool' for m in messages):
                calls=[('describe_business',{}),('read_decisions',{})]+[('read_business',{'section':s,'periodEnd':env['snapshot']['periodEnd']}) for s in ('conversion','supply','market')]
                return {'role':'assistant','content':None,'tool_calls':[{'id':str(i),'type':'function','function':{'name':n,'arguments':json.dumps(a)}} for i,(n,a) in enumerate(calls)]},{}
            assert tools is None, '完整数据已核查后直接生成，不允许重复查询'
            conversion=next(json.loads(m['content'])['result'] for m in messages if m['role']=='tool' and isinstance(json.loads(m['content'])['result'].get('evidenceIds'),dict))
            short=next(iter(conversion['evidenceIds'].values()))
            assert short.startswith('E')
            raw=json.dumps(finding).replace(json.dumps('ev1'),json.dumps(short))
            return {'role':'assistant','content':raw[:-1]},{}
    async def run():
        job=Job(id='home-test',businessId='b1',dataNature='demo',snapshotId='snap1',sessionId='home-s',mode='orchestrator',purpose='home',question='首页经营判断',envelope=env).model_dump(mode='json')
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path/'cp.sqlite')) as saver:
            out=await AgentRuntime(saver,model=Model()).graph.ainvoke({'job':job},{'configurable':{'thread_id':job['id']}})
            result=out['result'];assert result['finding']['homeDecision']['outlook']['forecastId']=='forecast-home'
            assert result['homeDecisionBasis']==env['homeDecisionContext'];assert out['selected']==['orchestrator'];assert not out.get('followupTargets')
            reads=result['toolReads'];assert all('periodEnd' not in r['arguments'] for r in reads if r['tool']=='read_business' and r['arguments']['section']=='supply')
            assert {r['arguments']['section'] for r in reads if r['tool']=='read_business' and r['status']=='completed'}=={'conversion','supply','market'}
    asyncio.run(run())

def test_outlook_cannot_invent_quantity_or_period_in_ai_text():
    env,finding=inputs();finding['homeDecision']['outlook']['title']='未来八周缺26件'
    with pytest.raises(ValueError,match='保存基线自动展示'):
        validate_home_decision(Finding.model_validate(finding),{'ev1'},env,{'conversion','supply','market'},{'K01'})

def test_growing_market_context_and_backtest_do_not_replicate_full_pages_or_folds():
    rows=[{'id':f'source-{i}','url':f'https://example.invalid/{i}','publishedAt':'2026-09-01','retrievedAt':'2026-10-07','verificationStatus':'source_read','historicalEligible':False,'excerpt':'原文摘要'*1000,'content':'全文'*10000,'limitations':['当前观察，不证明历史因果']} for i in range(40)]
    forecast={'id':'baseline','totals':{'units':0,'contributionMarginCents':None},'weeks':[],'products':[],'backtest':{'status':'insufficient_coverage','skippedFolds':[{'reason':'当时资料不可用','details':'详细过程'*1000} for _ in range(100)]},'forecastCoverage':{'status':'partial'}}
    finding={'id':'review','mode':'market','finding':{'conclusion':'竞品价格待核实','gaps':['缺少可比规格'],'evidenceIds':['source-1'],'marketWorkbench':{'large':rows}}}
    context={'marketEvidence':rows,'findings':[finding],'forecasts':[forecast]}
    out=home_context_view(context,{'forecast':forecast})
    assert len(out['marketEvidence'])==40
    assert [s['id'] for s in out['marketEvidence']]==[s['id'] for s in rows]
    assert all(s['modelExcerptIsPartial'] for s in out['marketEvidence'])
    assert out['marketEvidence'][1]['modelExcerptLimit']==450
    assert all(s['modelExcerptLimit']==120 for i,s in enumerate(out['marketEvidence']) if i!=1)
    assert out['findings'][0]['finding']['gaps']==['缺少可比规格']
    assert out['homeDecisionContext']['forecast']['backtest']['skippedFoldCount']==100
    assert out['homeDecisionContext']['forecast']['totals']['contributionMarginCents'] is None
    assert len(json.dumps(out,ensure_ascii=False).encode())<90000
    assert len(context['marketEvidence'][0]['excerpt'])==4000
    assert len(forecast['backtest']['skippedFolds'])==100

def joint_inputs():
    env,finding=inputs()
    env['homeDecisionContext']['schemaVersion']='home-decision-v3'
    env['decisionContext']={'marketEvidence':[{'id':'original','verificationStatus':'source_read','historicalEligible':False,'retrievedAt':'2026-10-07'}]}
    block={'title':'供给承接偏紧','summary':'购买仍有增长，库存需核实','evidenceIds':['ev1']}
    finding['homeDecision']['jointReview']={'status':block,'metricKeys':['stock','conversion'],'market':{'summary':'当前原文是后续观察，不能解释历史因果','evidenceIds':['original']},'confirmations':[{'question':'到货何时可售','why':'影响是否补货','check':'核对收货与质检','evidenceIds':['ev1']}],'nextAction':{**block,'whyFirst':'先消除供给不确定性','decisionGate':'确认可售后再比较投放','steps':['核对收货']},'alternatives':[{'action':'增加投放','whyNotFirst':'承接未确认'}]}
    return env,finding

def test_joint_review_is_required_in_v3_and_every_block_reference_is_validated():
    env,finding=joint_inputs()
    validate_home_decision(Finding.model_validate(finding),{'ev1','original'},env,{'conversion','supply','market'},{'K01'})
    finding['homeDecision']['jointReview']=None
    with pytest.raises(ValueError,match='联合研判'):validate_home_decision(Finding.model_validate(finding),{'ev1','original'},env,{'conversion','supply','market'},{'K01'})
    env,finding=joint_inputs();finding['homeDecision']['jointReview']['confirmations'][0]['evidenceIds']=['invented']
    with pytest.raises(ValueError,match='未实际读取'):validate_home_decision(Finding.model_validate(finding),{'ev1','original'},env,{'conversion','supply','market'},{'K01'})

def test_joint_market_cannot_cite_unread_source_or_repeat_metrics():
    env,finding=joint_inputs();env['decisionContext']['marketEvidence'][0]['verificationStatus']='fetch_failed'
    with pytest.raises(ValueError,match='已读取原文'):validate_home_decision(Finding.model_validate(finding),{'ev1','original'},env,{'conversion','supply','market'},{'K01'})
    env,finding=joint_inputs();finding['homeDecision']['jointReview']['metricKeys']=['stock','stock']
    with pytest.raises(ValueError,match='不能重复'):validate_home_decision(Finding.model_validate(finding),{'ev1','original'},env,{'conversion','supply','market'},{'K01'})

def test_market_citation_repair_identifies_internal_metric_and_verified_original():
    env,finding=joint_inputs()
    finding['homeDecision']['jointReview']['market']['evidenceIds']=['ev1','original']
    with pytest.raises(ValueError) as error:
        validate_home_decision(Finding.model_validate(finding),{'ev1','original'},env,{'conversion','supply','market'},{'K01'})
    assert 'homeDecision.jointReview.market.evidenceIds' in str(error.value)
    assert '请替换：["ev1"]' in str(error.value)
    assert '本轮已读市场原文ID：["original"]' in str(error.value)

def test_joint_context_preserves_ai_selected_sources_and_confirmation_directions():
    context={'findings':[{'id':'review','mode':'market','finding':{'marketWorkbench':{'judgment':{'title':'市场发现'},'nextStep':'核实适用机型','cells':[{'large':'matrix'}],'sources':[{'id':'selected-original','selected':True,'summary':'已筛选原文','relevance':'相关机型'},{'id':'unrelated','selected':False}]}}}]}
    out=home_context_view(context,{'schemaVersion':'home-decision-v3'})
    selected=out['findings'][0]['finding']['marketWorkbench']
    assert selected['nextStep']=='核实适用机型'
    assert [r['id'] for r in selected['sources']]==['selected-original']
    assert 'cells' not in selected
    assert len(context['findings'][0]['finding']['marketWorkbench']['sources'])==2

def test_home_prompt_deduplication_references_only_exact_equivalent_aggregates():
    from neo_agent.home_decision import deduplicate_home_view
    seen={};base={'totals':{'paidOrders':0,'margin':None},'weeklyTotals':[{'start':'2026-09-14','value':3}], 'productChannelAggregates':[{'productId':'P','channel':'shop','value':0}],'evidenceIds':{'stock':'exact'}}
    assert deduplicate_home_view(base,'conversion',seen)==base
    same=deduplicate_home_view(base,'market',seen)
    assert same['totals']['sameAsSection']=='conversion';assert same['weeklyTotals']['sameField']=='weeklyTotals'
    assert same['evidenceIds']==base['evidenceIds'];assert base['totals']['margin'] is None
    changed={**base,'totals':{'paidOrders':1,'margin':None}}
    assert deduplicate_home_view(changed,'supply',seen)['totals']==changed['totals']


def test_home_schema_keeps_joint_contract_without_unusable_write_types():
    from neo_agent.home_decision import home_output_schema
    schema=Finding.model_json_schema();compact=home_output_schema(schema)
    assert compact['properties']['organization']=={'type':'null'}
    assert 'JointReview' in compact['$defs']
    assert 'jointReview' in compact['$defs']['HomeDecision']['required']
    assert compact['$defs']['HomeDecision']['properties']['jointReview']=={'$ref':'#/$defs/JointReview'}
    assert 'MarketWorkbench' not in compact['$defs']
    assert len(json.dumps(compact)) < len(json.dumps(schema))*0.6
    assert schema['properties']['organization'] != compact['properties']['organization']


def test_provider_missing_closing_braces_do_not_change_business_content():
    from neo_agent.home_decision import close_json_containers
    env,finding=joint_inputs();valid=json.dumps(finding,ensure_ascii=False)
    raw=valid[:-1]
    assert close_json_containers(raw)==valid
    validate_home_decision(Finding.model_validate_json(close_json_containers(raw)),{'ev1','original'},env,{'conversion','supply','market'},{'K01'})
    for broken in ['{"text":"unfinished', '{"text":', '{"text":"value",', '{"wrong":]', '{"text":"value"}garbage']:
        assert close_json_containers(broken)==broken
    nested=json.dumps({'text':'braces } and " quoted','array':[{'value':2}]})[:-2]
    assert json.loads(close_json_containers(nested))['array']==[{'value':2}]
