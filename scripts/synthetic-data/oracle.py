"""Independent acceptance oracle: CSV aggregation only; never imports product code.

Financial accounting uses entry business dates. Person cohorts link paid order
lines to identified synthetic intent events and remove full quantity refunds
known at the stated cutoff. SKU supply denominator is independent of warehouses.
"""
import argparse
import csv
import json
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

SCRIPT=Path(__file__).resolve()
ROOT=next((p for p in SCRIPT.parents if (p/'server/contracts.ts').exists()),SCRIPT.parents[2])
DEFAULT=SCRIPT.parent.parent if SCRIPT.parent.name=='generators' else ROOT/'outputs/isolated-synthetic-20261004'
INTEGER={'quantity','amount_cents','variable_cost_cents','sellable_units','inventory_cost_cents','in_transit_units','safety_units','list_price_cents','unit_inventory_cost_cents','fulfilment_per_unit_cents','target_units_per_sku','safety_units_per_sku','restock_units','wanted_units','fulfilled_units','delta_units','before_units','after_units','units','version','budget_cents','week_index'}

def load(output):
 data={}
 for folder in ('master','raw','sidecars'):
  for path in sorted((output/'normal'/folder).glob('*.csv')):
   with path.open(newline='',encoding='utf-8') as f: rows=list(csv.DictReader(f))
   for row in rows:
    for key in list(row):
     if key in INTEGER:row[key]=int(row[key]) if row[key]!='' else None
     if key=='supply_target_ratio':row[key]=float(row[key])
   data[path.stem]=rows
 return data

def known_plans(data, as_of):
 cutoff=as_of+'T23:59:59+08:00'
 versions={}
 for row in data['arrival_plan_versions']:
  if row['known_at']<=cutoff and (row['plan_id'] not in versions or row['version']>versions[row['plan_id']]['version']):versions[row['plan_id']]=row
 received=defaultdict(int)
 for row in data['arrival_receipts']:
  if row['received_at']<=cutoff and row['known_at']<=cutoff:received[row['plan_id']]+=row['units']
 return [{**row,'remaining_units':row['units']-received[pid]} for pid,row in sorted(versions.items()) if row['units']>received[pid]]

def aggregate(data,start,end,as_of,product=None,channel=None,covered_zeros=True):
 selected=lambda r:(not product or r.get('product_id')==product) and (not channel or r.get('channel')==channel)
 inside=lambda r:start<=r['occurred_at'][:10]<=end
 orders=[r for r in data['orders'] if selected(r) and inside(r)]
 expenses=[r for r in data['expenses'] if selected(r) and inside(r)]
 events=[r for r in data['events'] if selected(r) and inside(r)]
 values={}
 for stage,kinds in {'A1':{'content_view'},'A2':{'engaged','click'},'A3':{'inquiry'},'A5':{'relationship'}}.items():
  rows=[r for r in events if r['event_type'] in kinds];values[stage]=sum(r['quantity'] for r in rows) if rows else None
 financial={
  'paidOrders':len({r['order_id'] for r in orders if r['entry_type']=='paid'}) if orders or covered_zeros else None,
  'netRevenueCents':sum((1 if r['entry_type']=='paid' else -1)*r['amount_cents'] for r in orders) if orders or covered_zeros else None,
  'spendCents':sum(r['amount_cents'] for r in expenses) if expenses or covered_zeros else None,
  'variableCostCents':sum((1 if r['entry_type']=='paid' else -1)*r['variable_cost_cents'] for r in orders) if orders or covered_zeros else None,
 }
 financial['contributionMarginCents']=financial['netRevenueCents']-financial['variableCostCents']-financial['spendCents'] if all(financial[k] is not None for k in ('netRevenueCents','variableCostCents','spendCents')) else None
 link={r['source_record_id']:r for r in data['order_customer_links']}
 cohorts={stage:{r['contact_id'] for r in events if r['event_type'] in kinds} for stage,kinds in {'A1':{'content_view'},'A2':{'engaged','click'},'A3':{'inquiry'}}.items()}
 net_lines=defaultdict(int)
 for r in data['orders']:
  if r['occurred_at'][:10]<=as_of:net_lines[(r['order_id'],r['order_line_id'])]+=(1 if r['entry_type']=='paid' else -1)*r['quantity']
 valid_lines=[r for r in orders if r['entry_type']=='paid' and net_lines[(r['order_id'],r['order_line_id'])]>0]
 paid_customers={link[r['source_record_id']]['customer_id'] for r in orders if r['entry_type']=='paid'}
 retained_customers={link[r['source_record_id']]['customer_id'] for r in valid_lines}
 a3=cohorts['A3'];a4=retained_customers&a3
 person={'stageDistinctCustomers':{k:len(v) for k,v in cohorts.items()},'paidDistinctCustomers':len(paid_customers),'retainedPaidCustomers':len(retained_customers),'cohortA4':len(a4),'a3ToA4CustomerRatio':len(a4)/len(a3) if a3 else None,'denominator':len(a3),'numerator':len(a4),'cutoff':as_of,'method':'period A3 customer cohort; same product/channel paid lines in period; positive remaining quantity at cutoff; customer counted once'}
 stocks={}
 for r in data['inventory']:
  if r['occurred_at'][:10]<=as_of and (not product or r['product_id']==product):
   key=(r['warehouse_id'],r['sku_id'])
   if key not in stocks or r['occurred_at']>stocks[key]['occurred_at']:stocks[key]=r
 stock_rows=sorted(stocks.values(),key=lambda r:(r['sku_id'],r['warehouse_id']))
 skus=defaultdict(lambda:dict(sellableUnits=0,safetyUnits=0,inTransitUnits=0,inventoryCostCents=0))
 for r in stock_rows:
  for src,dest in [('sellable_units','sellableUnits'),('safety_units','safetyUnits'),('in_transit_units','inTransitUnits'),('inventory_cost_cents','inventoryCostCents')]:skus[r['sku_id']][dest]+=r[src]
 sku_role={r['id']:r['role_id'] for r in data['skus']}
 role_ids={r['id'] for r in data['product_roles']};supply=[]
 for role in sorted(role_ids):
  members=[v for sid,v in skus.items() if sku_role[sid]==role]
  if not members:continue
  q=sum(v['sellableUnits']>=v['safetyUnits'] for v in members)
  supply.append(dict(roleId=role,skuCount=len(members),qualifiedSkuCount=q,ratio=q/len(members),targetRatio=0.8,inventoryCostCents=sum(v['inventoryCostCents'] for v in members)))
 return {'financial':financial,'events':values,'customerFunnel':person,'inventoryCostCents':sum(r['inventory_cost_cents'] for r in stock_rows) if stock_rows else None,'inventory':stock_rows,'supply':supply,'paidUnits':sum(r['quantity'] for r in orders if r['entry_type']=='paid'),'refundUnits':sum(r['quantity'] for r in orders if r['entry_type']=='refund'),'netUnits':sum((1 if r['entry_type']=='paid' else -1)*r['quantity'] for r in orders),'stockScope':'all warehouses; not channel-filtered'}

def build(output=DEFAULT):
 output=Path(output).resolve();d=load(output);manifest=json.loads((output/'manifest.json').read_text())
 periods={'full24':('2026-04-06','2026-09-20','2026-09-24'),'current8':('2026-07-27','2026-09-20','2026-09-24'),'previous8':('2026-06-01','2026-07-26','2026-07-30')}
 result={'oracleVersion':'csv-independent-v1','businessId':manifest['businessId'],'dataNature':'demo','seed':manifest['seed'],'periods':{},'weekly':[],'forecastCutoffs':[],'limitations':['Event counts and paid orders remain separate from linked customer cohort rates.','Comparison cohorts share a four-day observation lag after period end.','Financial returns posted in accounting period; person retention checked through stated cutoff.','Synthetic mechanisms do not validate causality or real-business forecasting accuracy.']}
 for key,(start,end,asof) in periods.items():
  value=aggregate(d,start,end,asof)
  value.update(periodStart=start,periodEnd=end,asOf=asof)
  value['channels']={c['id']:aggregate(d,start,end,asof,channel=c['id'],covered_zeros=False) for c in d['channels']}
  value['products']={p['id']:aggregate(d,start,end,asof,product=p['id'],covered_zeros=False) for p in d['products']}
  value['productChannel']={p['id']+'|'+c['id']:aggregate(d,start,end,asof,product=p['id'],channel=c['id'],covered_zeros=False) for p in d['products'] for c in d['channels']}
  value['roleMatrix']=[]
  product_role={p['id']:p['role_id'] for p in d['products']}
  for c in d['channels']:
   for role in d['product_roles']:
    paid=[r for r in d['orders'] if start<=r['occurred_at'][:10]<=end and r['channel']==c['id'] and product_role[r['product_id']]==role['id'] and r['entry_type']=='paid']
    a3=[r for r in d['events'] if start<=r['occurred_at'][:10]<=end and r['channel']==c['id'] and product_role[r['product_id']]==role['id'] and r['event_type']=='inquiry']
    fee=[r for r in d['expenses'] if start<=r['occurred_at'][:10]<=end and r['channel']==c['id'] and product_role[r['product_id']]==role['id']]
    value['roleMatrix'].append(dict(channelId=c['id'],roleId=role['id'],paidOrders=len({r['order_id'] for r in paid}) if paid else None,intentEvents=sum(r['quantity'] for r in a3) if a3 else None,spendCents=sum(r['amount_cents'] for r in fee) if fee else None))
  # Inventory coverage follows positive paid demand over the last four complete weeks.
  last4=date.fromisoformat(end)-timedelta(days=27)
  for pid,stats in value['products'].items():
   paid4=sum(r['quantity'] for r in d['orders'] if r['entry_type']=='paid' and r['product_id']==pid and last4.isoformat()<=r['occurred_at'][:10]<=end)
   stock=sum(r['sellable_units'] for r in stats['inventory'])
   stats['coverageDays']=round(stock/(paid4/28),1) if paid4 else None
   open_plans=[r for r in known_plans(d,asof) if r['product_id']==pid and r['planned_eta']>asof]
   stats['eta']=min((r['planned_eta'] for r in open_plans),default=None)
  result['periods'][key]=value
 for i in range(24):
  start=date(2026,4,6)+timedelta(weeks=i);end=start+timedelta(days=6)
  value=aggregate(d,str(start),str(end),str(end));value.update(weekIndex=i+1,start=str(start),end=str(end))
  result['weekly'].append(value)
 for i in (8,12,16,20,24):
  cutoff=date(2026,4,6)+timedelta(weeks=i)-timedelta(days=1)
  plans=known_plans(d,str(cutoff))
  result['forecastCutoffs'].append(dict(asOf=str(cutoff),openPlansKnownAtCutoff=plans,excludedFutureVersions=sum(r['known_at'][:10]>str(cutoff) for r in d['arrival_plan_versions']),eligibleWeekIndexes=list(range(1,i+1))))
 manual=json.loads((output/'manual-fixture.json').read_text());e=manual['expected'];rows=manual['rows'];o=rows['orders']
 assert sum((1 if r['entry_type']=='paid' else -1)*r['amount_cents'] for r in o)==e['netRevenueCents']
 assert sum((1 if r['entry_type']=='paid' else -1)*r['variable_cost_cents'] for r in o)==e['variableCostCents']
 assert e['netRevenueCents']-e['variableCostCents']-sum(r['amount_cents'] for r in rows['expenses'])==e['contributionMarginCents']
 assert len({r['order_id'] for r in o if r['entry_type']=='paid'})==e['paidOrders']
 # A second hand-sized case shows three view events but only two people.
 handmade=[('A1','sim-HC1'),('A1','sim-HC1'),('A1','sim-HC2'),('A2','sim-HC1'),('A2','sim-HC2'),('A3','sim-HC1')]
 result['manualChecks']={'financial':e,'customerDedup':{'input':handmade,'paidCustomerIds':['sim-HC1'],'expectedRawA1':3,'expectedDistinctA1':2,'expectedDistinctA2':2,'expectedDistinctA3':1,'expectedCohortA4':1,'expectedA3ToA4Ratio':1.0}}
 result['scenarioObservations']={'stockoutAttempts':sum(r['reason']=='stockout' for r in d['demand_attempts']),'zeroInventoryRows':sum(r['sellable_units']==0 for r in d['inventory']),'refundEntries':sum(r['entry_type']=='refund' for r in d['orders']),'ordersWithMultiplePaidLines':sum(n>1 for n in __import__('collections').Counter(r['order_id'] for r in d['orders'] if r['entry_type']=='paid').values()),'observationsDerivedFromRecords':True,'metricTargetsPreassigned':False}
 (output/'expected-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'full24':result['periods']['full24']['financial'],'current8':result['periods']['current8']['financial'],'personFunnel24':result['periods']['full24']['customerFunnel'],'scenarioObservations':result['scenarioObservations']},ensure_ascii=False))
 return result

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=DEFAULT);args=p.parse_args();build(args.output)
