from copy import deepcopy
from datetime import date,timedelta
import pytest
from neo_agent.engine import simulate,compare,CalculationError
from neo_agent.contracts import ScenarioAssumptions,Job

def fixture(weeks=8,stock=1000,cost=5000):
    start=date(2026,7,6);end=start+timedelta(days=weeks*7-1)
    rows=[]
    for n in range(weeks*7):
        d=(start+timedelta(days=n)).isoformat()
        rows.append({'id':str(n),'kind':'orders','fact':{'product_id':'P1','sku_id':'S1','channel':'c1','business_date':d,'entry_type':'paid','quantity':2,'amount_cents':20000,'variable_cost_cents':None if cost is None else cost*2}})
        rows.append({'id':'e'+str(n),'kind':'expenses','fact':{'product_id':'P1','channel':'c1','business_date':d,'amount_cents':1000}})
    s={'id':'snap1','businessId':'b1','dataNature':'demo','asOf':end.isoformat(),'periodStart':start.isoformat(),'periodEnd':end.isoformat(),'coverage':[{'kind':k,'sourceId':'a','start':start.isoformat(),'end':end.isoformat()} for k in ['orders','expenses']],'limitations':[],'evidenceIds':{'units':'ev1'},'data':{'inventory':[{'sku_id':'S1','product_id':'P1','warehouse_id':'W1','sellable_units':stock,'inventory_cost_cents':None if cost is None else stock*cost,'in_transit_units':0}],'financial':{},'events':{},'weeks':[],'channels':[]}}
    return {'snapshot':s,'facts':rows,'domain':{'arrivals':[]}}
A={'source':'user_assumption','note':'Test what-if','confirmed':True}
def adj(**kw):return {'adjustments':[{'productId':'P1','assumption':A,**kw}]}
def test_baseline_and_stock_units():
    r=simulate(fixture(stock=30));assert r['totals']['units']==30;assert r['totals']['unmetUnits']==26;assert r['totals']['endingUnits']==0;assert r['orderCount'] is None
    assert len(r['daily'])==28;assert r['backtest']['status']=='insufficient_history'
def test_budget_stock_bound_cost_increases():
    env=fixture(stock=20);b=simulate(env);r=compare(env,adj(budgetMultiplier=2,budgetResponse=1));assert r['totals']['units']==b['totals']['units'];assert r['totals']['spendCents']==2*b['totals']['spendCents'];assert r['delta']['contributionMarginCents']<0

def test_more_stock_does_not_create_demand():
    env=fixture();first=(date.fromisoformat(env['snapshot']['asOf'])+timedelta(days=1)).isoformat()
    r=compare(env,{'arrivals':[{'skuId':'S1','warehouseId':'W1','date':first,'units':1000,'assumption':A}]});assert r['delta']['units']==0

def test_discount_can_increase_volume_but_reduce_margin():
    r=compare(fixture(),adj(priceMultiplier=.8,priceElasticity=-.5));assert r['delta']['units']>0;assert r['delta']['contributionMarginCents']<0

def test_missing_cost_missing_response_and_short_history():
    assert simulate(fixture(cost=None))['totals']['contributionMarginCents'] is None
    for kw in [{'priceMultiplier':.9},{'budgetMultiplier':2}]:
        with pytest.raises(CalculationError):simulate(fixture(),adj(**kw))
    with pytest.raises(CalculationError):simulate(fixture(weeks=3))

def test_transfer_conserves_and_overdraw_rejected():
    env=fixture(stock=100);d=(date.fromisoformat(env['snapshot']['asOf'])+timedelta(days=1)).isoformat()
    t={'skuId':'S1','fromWarehouse':'W1','toWarehouse':'W2','date':d,'units':50,'assumption':A}
    assert simulate(env,{'transfers':[t]})['totals']['endingUnits']==simulate(env)['totals']['endingUnits']
    t['units']=101
    with pytest.raises(CalculationError):simulate(env,{'transfers':[t]})

def test_arrival_replacement_not_duplicate_and_no_negative_stock():
    env=fixture(stock=0);d=(date.fromisoformat(env['snapshot']['asOf'])+timedelta(days=1)).isoformat()
    env['domain']['arrivals']=[{'id':'p','skuId':'S1','warehouseId':'W1','date':d,'units':10}]
    r=simulate(env,{'arrivals':[{'skuId':'S1','warehouseId':'W1','date':d,'units':20,'replacesPlanId':'p','assumption':A}]})
    assert r['totals']['units']==20;assert all(x['endingUnits']>=0 for x in r['daily'])

def test_combination_applies_once_and_overlaps_rejected():
    r=simulate(fixture(),adj(budgetMultiplier=2,budgetResponse=1,conversionMultiplier=1.5));assert r['totals']['units']==168
    a=adj(conversionMultiplier=1.1);a['adjustments']*=2
    with pytest.raises(CalculationError):simulate(fixture(),a)

def test_mix_conserves_channel_demand():
    e=fixture();extra=[]
    for row in e['facts']:
        r=deepcopy(row);r['id']+='p2';r['fact']['product_id']='P2'
        if 'sku_id' in r['fact']:r['fact']['sku_id']='S2'
        extra.append(r)
    e['facts']+=extra;e['snapshot']['data']['inventory'].append({'sku_id':'S2','product_id':'P2','warehouse_id':'W1','sellable_units':1000,'inventory_cost_cents':5000000})
    a={'adjustments':[{'productId':p,'mixWeight':w,'assumption':A} for p,w in [('P1',.2),('P2',.8)]]}
    assert simulate(e,a)['totals']['units']==simulate(e)['totals']['units']
    a['adjustments'][0]['mixWeight']=.9
    with pytest.raises(CalculationError):simulate(e,a)

def test_backtest_chronological_and_stable():
    r=simulate(fixture(weeks=16));assert r['backtest']['status']=='historical_availability_unverified';assert r['backtest']['timeAware'] is True

def test_missing_orders_coverage_and_unknown_product_fail():
    e=fixture();e['snapshot']['coverage'][0]['end']=e['snapshot']['periodStart']
    with pytest.raises(CalculationError):simulate(e)
    a=adj();a['adjustments'][0]['productId']='new'
    with pytest.raises(CalculationError):simulate(fixture(),a)

def test_strict_assumptions_reject_nan_unknown_fields():
    with pytest.raises(ValueError):ScenarioAssumptions.model_validate(adj(priceMultiplier=float('nan')))
    with pytest.raises(ValueError):ScenarioAssumptions.model_validate({'executePurchase':True})

def test_refunds_reduce_revenue_once_and_do_not_restock():
    e=fixture();r=deepcopy(e['facts'][-2]);r['fact'].update(entry_type='refund',quantity=4,amount_cents=40000,variable_cost_cents=20000);e['facts'].append(r)
    result=simulate(e)
    assert result['totals']['units']==56
    assert abs(result['totals']['netRevenueCents']-520000)<=14
    assert result['totals']['endingUnits']==944

def test_inventory_value_survives_transfer_and_uses_stock_basis():
    e=fixture(stock=100);e['snapshot']['data']['inventory'][0]['inventory_cost_cents']=600000
    d=(date.fromisoformat(e['snapshot']['asOf'])+timedelta(days=1)).isoformat()
    r=simulate(e,{'transfers':[{'skuId':'S1','fromWarehouse':'W1','toWarehouse':'W2','date':d,'units':50,'assumption':A}]})
    assert r['totals']['endingInventoryCostCents']==264000
    assert sum(p['units'] for p in r['products'])==r['totals']['units']
