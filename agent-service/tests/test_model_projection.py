"""Compression never changes complete returned values or missingness."""
import copy
from neo_agent.agent import model_table_data,model_reference_data
from neo_agent.home_decision import synthesis_context_view

def restore(value,refs=None):
    if not isinstance(value,(dict,list)):return value
    if isinstance(value,list):return [restore(v,refs) for v in value]
    if 'sameAsContextRef' in value:return restore(refs[value['sameAsContextRef']],refs)
    refs=value.get('contextRefs',refs)
    if all(k in value for k in ('columns','rows','nestedColumns','rowCount')):
        rows=[]
        value={k:restore(v,refs) for k,v in value.items()}
        for row in value['rows']:
            result={k:restore(v,refs) for k,v in value.get('commonColumns',{}).items()}
            for key,v in zip(value['columns'],row):
                if isinstance(v,dict) and v=={'absentColumn':True}:continue
                if key in value.get('dictionaryColumns',{}):v=value['dictionaryColumns'][key][v]
                if key in value['nestedColumns']:v=dict(zip(value['nestedColumns'][key],v))
                result[key]=restore(v,refs)
            rows.append(result)
        assert len(rows)==value['rowCount'];return rows
    return {k:restore(v,refs) for k,v in value.items() if k!='contextRefs'}

def test_prompt_tables_and_context_refs_restore_all_dates_status_and_missing_fields():
    rows=[{'skuId':'scoped-long-sku-'+str(n%2),'date':'2026-09-24','status':'source_known_but_business_unconfirmed','units':n,'metricStatus':{'revenue':'observed','cost':'missing'},**({'cost':None} if n%2 else {})} for n in range(77)]
    source={'inventory':rows,'arrivals':copy.deepcopy(rows),'limitations':['资料覆盖只由提供者声明，未经业务核实。']*5}
    original=copy.deepcopy(source);compressed=model_reference_data(model_table_data(source))
    assert restore(compressed)==original and source==original
    assert 'contextRefs' in compressed
    assert compressed['contextRefs'] or compressed['inventory']['dictionaryColumns']

def test_synthesis_keeps_all_choices_totals_unknown_time_and_counterevidence():
    forecast={'id':'f1','asOf':'2026-09-24','totals':{'units':20,'contributionMarginCents':None},'weeks':[{'weekStart':'2026-09-28','units':20}],'forecastCoverage':{'status':'partial','unestimatedSkuIds':['s2']},'backtestAvailability':{'status':'no_paid_series'},'limitations':['缺少历史可用时点；部分成本未知。']}
    finding={'conclusion':'资料不足需核对','alternatives':['同期变化不足以证明因果'],'gaps':['覆盖未经业务核实'],'candidates':['核对可履约条件'],'evidenceIds':['e1'],'homeDecision':{'obsoleteUIOnly':True},'businessReview':{'title':'同一判断'}}
    context={'findings':[{'id':'r1','finding':finding}],'forecasts':[forecast],'scenarios':[{**forecast,'id':'s1','parentId':'f1','delta':{'contributionMarginCents':None},'assumptions':{'confirmed':False}}],'decisions':[{'id':'d1','scenarioId':'s1','selectedScenario':forecast,'status':'saved','actualOutcome':None}],'marketEvidence':[{'id':'ext','verificationStatus':'source_read','publishedAt':'2026-09-24','retrievedAt':'2026-10-07'}],'limitations':['候选未核验']}
    original=copy.deepcopy(context);result=synthesis_context_view(context,{'forecast':forecast})
    assert context==original
    assert result['forecasts'][0]['totals']==forecast['totals']
    assert result['forecasts'][0]['forecastCoverage']==forecast['forecastCoverage']
    assert result['forecasts'][0]['backtestAvailability']==forecast['backtestAvailability']
    assert result['forecasts'][0]['limitations']==forecast['limitations']
    for field in ('conclusion','alternatives','gaps','candidates','evidenceIds'):assert result['findings'][0]['finding'][field]==finding[field]
    assert result['decisions'][0]['id']=='d1' and result['decisions'][0]['actualOutcome'] is None
    assert result['scenarios'][0]['assumptions']['confirmed'] is False
    assert result['marketSourcePagination']['candidateCount']==1 and result['marketSourcePagination']['includedCount']==0

import pytest
from decimal import Decimal
from neo_agent.validation import validate_numeric_prose,numeric_values

def test_professional_review_schema_does_not_authorize_operating_optimizer_result():
    from neo_agent.agent import SCHEMA
    from neo_agent.home_decision import professional_output_schema,home_output_schema
    from neo_agent.professional_reviews import COMMON_REVIEW
    for market_workbench in (False,True):
        schema=professional_output_schema(SCHEMA,market_workbench)
        assert schema['properties']['operatingRecommendation']=={'type':'null'}
        assert 'OperatingRecommendation' not in schema['$defs']
        assert schema['properties']['followups']['maxItems']==0
    assert 'operatingRecommendation必须为null' in COMMON_REVIEW
    assert home_output_schema(SCHEMA)['properties']['operatingRecommendation']=={'type':'null'}

def test_saved_customer_journey_growth_percentage_is_not_rejected():
    source={'customerJourney':{'changes':[{'stage':'A4','current':46,'previous':38,'change':(46-38)/38}]}}
    validate_numeric_prose({'conclusion':'购买客户增21.1%。'},numeric_values(source),{})

def test_calculated_relative_change_supports_rounded_decimal_ratio_but_not_money():
    source={'spendCents':{'differenceCents':95000,'relativeChange':1/12,'status':'comparable'}}
    allowed=numeric_values(source)
    for text in ['核对广告花费增量0.0833（950.0元）。','广告花费增加8.3%。']:
        validate_numeric_prose({'candidates':[text]},allowed,{})
    for text in ['广告花费增量0.0834。','广告花费0.0833元。','广告花费增加0.0833%。']:
        with pytest.raises(ValueError):validate_numeric_prose({'conclusion':text},allowed,{})

@pytest.mark.parametrize('text',[
    '最近四周购买客户46人较前四周38人增21.1%。',
    '购买客户增百分之二十一点一。',
    '意向到购买转化率由51.1%升至66.7%。',
])
def test_customer_journey_percentages_match_the_precision_of_read_results(text):
    from neo_agent.validation import percentage_values
    source={'windowWeeks':4,'customerJourney':{
        'changes':[{'stage':'A4','current':46,'previous':38,'change':(46-38)/38}],
        'recent':{'transitions':[{'rate':36/54}]},
        'previous':{'transitions':[{'rate':24/47}]},
    }}
    validate_numeric_prose({'conclusion':text},numeric_values(source),{},percentage_grounding=percentage_values(source))

@pytest.mark.parametrize('text',['购买客户增21.2%。','购买客户增21.10%。','转化率0.7%。','购买客户47人。'])
def test_percentage_rounding_does_not_admit_invented_or_wrong_unit_quantities(text):
    from neo_agent.validation import percentage_values
    source={'customerJourney':{'changes':[{'stage':'A4','current':46,'previous':38,'change':(46-38)/38}]},'rate':36/54}
    with pytest.raises(ValueError):
        validate_numeric_prose({'conclusion':text},numeric_values(source),{},percentage_grounding=percentage_values(source))

def test_percentage_rounding_uses_unrounded_ratio_and_never_rounds_counts_or_money():
    from neo_agent.validation import percentage_values
    source={'rate':.21049,'netRevenueCents':2105,'paidUnits':46}
    grounded=percentage_values(source)
    validate_numeric_prose({'conclusion':'比例21.0%。'},numeric_values(source),{},percentage_grounding=grounded)
    for text in ['比例21.1%。','成交21.1元。','销量46.1件。']:
        with pytest.raises(ValueError):validate_numeric_prose({'conclusion':text},numeric_values(source),{},percentage_grounding=grounded)
    with pytest.raises(ValueError):
        validate_numeric_prose({'conclusion':'比例21.1%。'},numeric_values({'netRevenueCents':2105}),{},percentage_grounding=set())

def test_percentage_sources_survive_context_merging_and_exclude_non_ratio_fields():
    from neo_agent.validation import percentage_values
    allowed=numeric_values({'paidUnits':46})
    allowed.update(numeric_values({'refundRate':.21052631578947367}))
    validate_numeric_prose({'conclusion':'比例21.1%。'},allowed,{})
    assert percentage_values({'calibrationBlocks':21.0526,'corporate':.210526,'difference':.210526})==set()
    assert percentage_values({'current':46,'previous':38,'change':8})==set()

def test_short_calendar_dates_are_not_concatenated_with_chinese_week_counts():
    from decimal import Decimal
    validate_numeric_prose({'conclusion':'先核对9/21、9/28两周覆盖，再检查2026-09-21与2026-09-28。'}, {Decimal(2)}, {})
    validate_numeric_prose({'conclusion':'统计期间2026-08-10至10-04，订单69笔。'}, {Decimal(69)}, {})
    validate_numeric_prose({'conclusion':'最近四周（8/24-9/20）与前四周（7/27-8/23）基本持平。'}, {Decimal(4)}, {})
    with pytest.raises(ValueError):validate_numeric_prose({'conclusion':'订单9/28笔'}, {Decimal(2)}, {})
    with pytest.raises(ValueError):validate_numeric_prose({'conclusion':'库存999件'}, {Decimal(2)}, {})
    with pytest.raises(ValueError):validate_numeric_prose({'conclusion':'日期2026-02-31'}, set(), {})

@pytest.mark.parametrize('text',['净成交九百万元，预计收益一千万元','售出两万件','支付三十笔','库存9百件','成交900万元','百分之九十','净成交玖佰万元','预计收益九百万','成交900,000元'])
@pytest.mark.parametrize('nested',[False,True])
def test_chinese_and_mixed_quantities_require_actual_calculated_values(text,nested):
    document={'homeDecision':{'jointReview':{'nextAction':{'summary':text}}}} if nested else {'conclusion':text}
    with pytest.raises(ValueError,match='数量'):validate_numeric_prose(document,set(),{})

def test_supported_chinese_amounts_normalize_units_without_semantic_support_claim():
    allowed=numeric_values({'netRevenueCents':900000000,'rate':.682,'paidUnits':20000})
    for text in ('净成交九百万元','净成交900万元','净成交玖佰万元','售出两万件','占比百分之六十八点二'):
        validate_numeric_prose({'conclusion':text},allowed,{})
    with pytest.raises(ValueError):validate_numeric_prose({'conclusion':'净成交九百万元'}, {Decimal(900)}, {})
    with pytest.raises(ValueError):validate_numeric_prose({'conclusion':'成交900,000元'}, {Decimal(900),Decimal(0)}, {})
    validate_numeric_prose({'conclusion':'成交900,000元'}, {Decimal(900000)}, {})
    validate_numeric_prose({'conclusion':'成交零万元'}, {Decimal(0)}, {})
