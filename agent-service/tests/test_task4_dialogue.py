import copy
import pytest
from test_unified_runtime import job,execute,QueryModel
from neo_agent.business_queries import query_facts
from neo_agent.task_plan import plan_task

@pytest.mark.parametrize('question',['你好','您好！','帮助','谢谢'])
def test_normal_conversation_uses_light_task_without_search_or_forecast(question):
    p=plan_task(job(question=question,mode='joint'));assert p['taskType']=='QUERY';assert p['budgetClass']=='simple'
    assert not {'search_market','forecast','simulate_scenario'}&set(p['tools'])

def test_frozen_sku_query_exact_stock_and_unallocated_cost_are_not_product_totals():
    env=job()['envelope'];row=copy.deepcopy(next(r for r in env['facts'] if r['kind']=='orders'))
    row['id']='other-sku';row['fact']['sku_id']='S2';row['fact']['quantity']=999;env['facts'].append(row)
    inv={'id':'inventory','kind':'inventory','fact':{'product_id':'P1','sku_id':'S1','business_date':env['snapshot']['asOf'],'warehouse_id':'east','sellable_units':7,'inventory_cost_cents':700}}
    other=copy.deepcopy(inv);other['id']='other-stock';other['fact'].update(sku_id='S2',sellable_units=999)
    env['facts'] += [inv,other];env['conversation']={'active':{'entityId':'P1','skuId':'S1'}}
    data=query_facts(env,'conversion',{'productId':'P1','skuId':'S1'});assert data['totals']['paidUnits']==112
    assert data['totals']['spendCents'] is None;assert data['totals']['contributionMarginCents'] is None
    stock=query_facts(env,'supply',{'productId':'P1','skuId':'S1'});assert stock['inventoryPosition']['sellableUnits']==7
    with pytest.raises(ValueError):query_facts(env,'supply',{'skuId':'S2'})
