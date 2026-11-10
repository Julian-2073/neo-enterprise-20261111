from copy import deepcopy
from datetime import date, timedelta
import json
import pytest
from neo_agent.business_tools import read_fact_view
from neo_agent.agent import model_tool_data


def frozen():
    start=date(2026,4,6)
    rows=[]
    for week in range(24):
        d=(start+timedelta(days=7*week)).isoformat()
        for channel in ('sim-c1','sim-c2'):
            for n in range(25):
                key=f'sim-{week}-{channel}-{n}'
                f={'product_id':'sim-P1','channel':channel,'business_date':d}
                rows.append({'id':key,'kind':'orders','fact':{**f,'order_id':key,'entry_type':'paid','quantity':2,'amount_cents':1000,'variable_cost_cents':600}})
            rows.append({'id':f'sim-event-{week}-{channel}','kind':'events','fact':{**f,'event_type':'inquiry','quantity':100+week}})
            rows.append({'id':f'sim-expense-{week}-{channel}','kind':'expenses','fact':{**f,'amount_cents':200}})
    return {'snapshot':{'id':'sim-24w-v1','businessId':'neo-sim-acceptance-20261004','businessName':'NEO 隔离模拟企业','dataNature':'demo','asOf':'2026-09-24','periodStart':'2026-04-06','periodEnd':'2026-09-20',
        'coverage':[{'kind':k,'sourceId':'sim-source','start':'2026-04-06','end':'2026-09-20'} for k in ('orders','expenses','events','inventory')],
        'evidenceIds':{'orders':'sim-ev-orders','events':'sim-ev-events'},'limitations':[]},'facts':rows,'domain':{}}


def test_complete_totals_and_24_week_product_channel_groups_not_twenty_row_sample():
    r=read_fact_view(frozen(),'market',{'grain':'week'})
    assert r['factCount']==24*2*27 and len(r['facts'])==20 and r['truncated']
    assert r['totals']['paidUnits']==24*2*25*2
    assert r['totals']['netRevenueCents']==24*2*25*1000
    assert r['totals']['spendCents']==24*2*200
    assert r['totals']['behaviorCounts']['A3']==2*(24*100+23*24//2)
    assert len(r['weeklyTotals'])==24 and r['aggregateCount']==48
    assert all(w['completeWeek'] for w in r['weeklyTotals'])
    assert r['weeklyTotals'][0]['paidUnits']==100
    assert r['queryEvidence']['scope']==r['scope']
    assert r['queryEvidence']['sourceEvidenceIds']==['sim-ev-orders','sim-ev-events']
    assert len(r['queryEvidence']['matchingFactIdsHash'])==64


def test_same_length_previous_inside_frozen_input_and_coverage():
    env=frozen()
    r=read_fact_view(env,'market',{'productId':'sim-P1','channel':'sim-c1','periodStart':'2026-08-24','periodEnd':'2026-09-20','grain':'week','comparePrevious':True})
    p=r['previousPeriod']
    assert p['scope']['periodStart']=='2026-07-27' and p['scope']['periodEnd']=='2026-08-23'
    assert r['totals']['paidUnits']==200 and p['totals']['paidUnits']==200
    assert p['comparison']['paidUnits']['difference']==0
    assert r['totals']['behaviorCounts']['A3']==120+121+122+123
    assert p['comparison']['A3']['difference']==16
    assert p['comparison']['A3']['relativeChange']==16/(116+117+118+119)
    assert r['queryEvidence']['matchingFactIdsHash']!=p['queryEvidence']['matchingFactIdsHash']


def test_previous_outside_scope_is_missing_not_zero_or_unbounded_read():
    r=read_fact_view(frozen(),'conversion',{'comparePrevious':True})
    assert r['previousPeriod']['status']=='missing'
    assert r['previousPeriod']['totals'] is None
    with pytest.raises(ValueError,match='授权冻结'):read_fact_view(frozen(),'conversion',{'periodStart':'2026-04-05'})
    with pytest.raises(ValueError,match='授权冻结'):read_fact_view(frozen(),'conversion',{'periodEnd':'2026-09-24'})


def test_missing_zero_partial_are_distinct_and_zero_baseline_has_no_growth():
    env=frozen()
    env['facts']=[{'id':'sim-z','kind':'expenses','fact':{'product_id':'sim-P1','channel':'sim-c1','business_date':'2026-09-14','amount_cents':0}}]
    r=read_fact_view(env,'market',{})
    assert r['totals']['spendCents']==0
    assert r['totals']['paidUnits'] is None
    assert r['totals']['behaviorCounts']['A3'] is None
    assert r['totals']['metricStatus']['spendCents']['status']=='observed'
    env['facts'].append({'id':'sim-m','kind':'expenses','fact':{'product_id':'sim-P1','channel':'sim-c1','business_date':'2026-09-14','amount_cents':None}})
    assert read_fact_view(env,'market',{})['totals']['spendCents'] is None
    env['facts']=[{'id':'sim-prev','kind':'expenses','fact':{'business_date':'2026-09-07','amount_cents':0}}, {'id':'sim-cur','kind':'expenses','fact':{'business_date':'2026-09-14','amount_cents':100}}]
    d=read_fact_view(env,'market',{'periodStart':'2026-09-14','periodEnd':'2026-09-20','comparePrevious':True})['previousPeriod']['comparison']['spendCents']
    assert d['relativeChange'] is None and d['differenceCents']==100


def test_partial_coverage_blocks_growth_even_when_numeric_sums_exist():
    env=frozen();env['snapshot']['coverage'][0]['end']='2026-09-06'
    r=read_fact_view(env,'conversion',{'periodStart':'2026-09-07','periodEnd':'2026-09-20','comparePrevious':True})
    assert r['totals']['paidUnits']==200
    assert r['previousPeriod']['comparison']['paidUnits']['status']=='missing'


def test_frozen_product_channel_and_identity_cannot_expand():
    env=frozen();env['snapshot']['productId']='sim-P1';env['snapshot']['channel']='sim-c1'
    assert read_fact_view(env,'conversion',{})['totals']['paidUnits']==1200
    with pytest.raises(ValueError,match='授权冻结'):read_fact_view(env,'conversion',{'channel':'sim-c2'})
    env['facts'][0]['fact']['business_id']='neo-live-demo'
    with pytest.raises(ValueError,match='跨企业'):read_fact_view(env,'conversion',{})


def test_unknown_slice_and_missing_channel_not_all_channel_fallback():
    env=frozen();env['facts'].append({'id':'sim-unknown','kind':'expenses','fact':{'business_date':'2026-09-14','channel':None,'product_id':None,'amount_cents':123}})
    assert read_fact_view(env,'market',{'channel':'sim-c1'})['totals']['spendCents']==4800
    r=read_fact_view(env,'market',{'channel':'no-such-channel'})
    assert r['factCount']==0 and r['totals']['spendCents'] is None
    assert any(g['channel'] is None for g in read_fact_view(env,'market',{})['productChannelAggregates'])


def test_aggregate_pagination_does_not_truncate_totals_or_weeks():
    env=frozen()
    env['facts']+=deepcopy(env['facts'])
    for r in env['facts'][1296:]:
        r['id']+='-p2';r['fact']['product_id']='sim-P2'
    first=read_fact_view(env,'conversion',{'grain':'week'})
    last=read_fact_view(env,'conversion',{'grain':'week','aggregateOffset':60})
    assert first['aggregateCount']==96 and len(first['productChannelAggregates'])==60
    assert first['nextAggregateOffset']==60 and len(last['productChannelAggregates'])==36
    assert first['totals']==last['totals'] and first['weeklyTotals']==last['weeklyTotals']


def test_inventory_uses_last_position_not_sum_across_weeks_or_future():
    env=frozen()
    env['facts']=[{'id':f'sim-stock-{i}','kind':'inventory','fact':{'sku_id':'sim-S1','product_id':'sim-P1','warehouse_id':'sim-W1','business_date':d,'sellable_units':n,'in_transit_units':0,'inventory_cost_cents':n*100}} for i,(d,n) in enumerate([('2026-09-07',50),('2026-09-14',20),('2026-09-24',0),('2026-09-25',999)])]
    r=read_fact_view(env,'supply',{'periodStart':'2026-09-07','grain':'week'})
    assert r['inventoryPosition']['sellableUnits']==0
    assert r['inventoryPosition']['asOf']=='2026-09-24'
    assert [w['inventoryPosition']['sellableUnits'] for w in r['weeklyTotals']]==[50,20]
    assert read_fact_view(env,'supply',{'periodEnd':'2026-09-13'})['inventoryPosition']['sellableUnits']==50


def test_inventory_time_conflict_and_missing_stock_stay_visible():
    env=frozen();env['facts']=[{'id':'sim-stock','kind':'inventory','fact':{'business_date':'2026-09-14','sku_id':'s','warehouse_id':'w','sellable_units':None}}]
    assert read_fact_view(env,'supply',{})['inventoryPosition']['sellableUnits'] is None
    env['facts']+=[{'id':'sim-conflict','kind':'inventory','fact':{**env['facts'][0]['fact'],'sellable_units':1}}]
    with pytest.raises(ValueError,match='冲突库存'):read_fact_view(env,'supply',{})


def test_currency_trace_partial_values_and_comparisons_convert_once():
    env=frozen()
    env['facts']=[{'id':'sim-prev','kind':'expenses','fact':{'business_date':'2026-09-07','amount_cents':100}}, {'id':'sim-cur','kind':'expenses','fact':{'business_date':'2026-09-14','amount_cents':300}}]
    raw=read_fact_view(env,'market',{'periodStart':'2026-09-14','periodEnd':'2026-09-20','comparePrevious':True})
    converted=model_tool_data(raw)
    assert converted['totals']['spendYuan']==3
    assert converted['totals']['metricStatus']['spendYuan']['knownValueYuan']==3
    assert converted['previousPeriod']['comparison']['spendYuan']['differenceYuan']==2
    assert converted['previousPeriod']['comparison']['spendYuan']['relativeChange']==2
    assert env['facts'][1]['fact']['amount_cents']==300


def test_inventory_position_pagination_returns_all_positions_and_full_total():
    env=frozen()
    env['facts']=[{'id':f'sim-stock-{i}','kind':'inventory','fact':{'business_date':'2026-09-24','sku_id':f'sim-S{i:03d}','warehouse_id':'sim-W1','sellable_units':i,'product_id':'sim-P1'}} for i in range(75)]
    first=read_fact_view(env,'supply',{})
    last=read_fact_view(env,'supply',{'inventoryOffset':60})
    assert first['inventoryPositionCount']==75 and first['nextInventoryOffset']==60
    assert len(first['inventoryPositions'])==60 and len(last['inventoryPositions'])==15
    assert first['inventoryPosition']['sellableUnits']==75*74//2
    assert first['inventoryPosition']==last['inventoryPosition']


def test_invalid_dates_or_unclassified_rows_not_inferred_as_zero_orders():
    env=frozen();env['facts']=[{'id':'sim-incomplete','kind':'orders','fact':{'business_date':'2026-09-14','quantity':100,'amount_cents':10000}}, {'id':'sim-undated','kind':'orders','fact':{}}]
    r=read_fact_view(env,'conversion',{})
    assert r['quality']=={'undatedFactCount':1,'unclassifiedOrderCount':1}
    assert r['totals']['paidUnits'] is None and r['totals']['netRevenueCents'] is None
