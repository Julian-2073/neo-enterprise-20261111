import copy,json
from neo_agent.agent import model_business_data,model_tool_data

def test_model_projection_keeps_all_week_groups_values_missingness_and_evidence():
    groups=[{'productId':str(i),'paidOrders':i,'netRevenueCents':i*123,'metricStatus':{'paidOrders':{'status':'observed','knownValue':i,'rowCount':i},'spendCents':{'status':'partial','knownValueCents':12,'missingRows':2}},'factIds':['audit-row'],'matchingFactIdsHash':'audit-hash'} for i in range(192)]
    original={'weeklyMetrics':[{'groups':groups}],'queryEvidence':{'matchingFactIdsHash':'full-hash','factCount':3259},'scopedEvidenceIds':['full-evidence'],'facts':[{'id':'audit-row'}],'domain':{'customers':[{'id':'private-customer'}],'arrivals':[{'id':'arrival','units':30,'status':'in_transit','date':'2026-10-06'}]}}
    before=copy.deepcopy(original);out=model_business_data(original)
    assert original==before
    assert len(out['weeklyMetrics'][0]['groups'])==192
    for i,g in enumerate(out['weeklyMetrics'][0]['groups']):
        assert g['paidOrders']==i and g['netRevenueCents']==i*123
        assert g['metricStatus']['paidOrders']=='observed'
        assert g['metricStatus']['spendCents']=={'status':'partial','knownValueCents':12,'missingRows':2}
    assert out['queryEvidence']==original['queryEvidence']
    assert out['scopedEvidenceIds']==original['scopedEvidenceIds']
    assert out['domain']['customers']['recordCount']==1
    assert out['domain']['arrivals']==original['domain']['arrivals']
    assert 'private-customer' not in json.dumps(out)
    assert model_tool_data(out)['weeklyMetrics'][0]['groups'][1]['netRevenueYuan']==1.23

def test_week_queries_keep_all_totals_and_expose_existing_detail_pagination():
    value={'scope':{'grain':'week'},'weeklyTotals':[{'weekStart':str(i),'paidOrders':i} for i in range(24)],'productChannelAggregates':[{'channel':'douyin'}]*60,'nextAggregateOffset':60,'aggregateCount':192,'weeklyMetrics':[{'groups':[{'channel':'douyin'}]*192}]}
    before=copy.deepcopy(value);out=model_business_data(value)
    assert out['weeklyTotals']==value['weeklyTotals'] and len(out['weeklyTotals'])==24
    assert len(out['productChannelAggregates'])==60 and out['aggregateCount']==192 and out['nextAggregateOffset']==60
    assert 'weeklyMetrics' not in out and 'nextAggregateOffset' in out['weeklyDetailPolicy']
    assert value==before

def test_imported_channel_identifiers_are_used_in_business_description():
    from neo_agent.business_tools import describe_business
    from test_engine import fixture
    env=fixture();env['domain']['channels']=[{'id':'sim-douyin','name':'抖音模拟店铺'},{'id':'sim-tmall','name':'天猫模拟店铺'}]
    assert describe_business(env)['displayNames']['channels']=={'sim-douyin':'抖音模拟店铺','sim-tmall':'天猫模拟店铺'}

def test_prompt_table_roundtrips_every_value_and_nested_status_without_mutation():
    from neo_agent.agent import model_table_data
    value=[{'weekStart':str(i),'paidOrders':i,'spendYuan':None if i==3 else 0,'metricStatus':{'paidOrders':'observed','spendYuan':'missing' if i==3 else 'observed'}} for i in range(24)]
    before=copy.deepcopy(value);out=model_table_data(value)
    assert out['rowCount']==24
    restored=[]
    for row in out['rows']:
        obj=dict(zip(out['columns'],row))
        for key,columns in out['nestedColumns'].items():obj[key]=dict(zip(columns,obj[key]))
        restored.append(obj)
    assert restored==before and value==before
    assert len(json.dumps(out)) < len(json.dumps(value))

def test_missing_metric_citation_strings_do_not_enter_model_but_remain_in_audit():
    value={'totals':{'metricStatus':{'A1':{'status':'missing'},'paidOrders':{'status':'observed','knownValue':127}}},'scopedEvidenceIds':['snap:view:week:2026-09-14:A1::sim-douyin','snap:view:week:2026-09-14:paidOrders::sim-douyin']}
    before=copy.deepcopy(value);out=model_business_data(value)
    assert out['scopedEvidenceIds']==[value['scopedEvidenceIds'][1]]
    assert value==before
