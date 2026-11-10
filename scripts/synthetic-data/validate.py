"""Read-only quality, relationships, ledger, SQL arithmetic, no-leak and reproducibility checks."""
import csv
import hashlib
import json
import sqlite3
import tempfile
from collections import Counter,defaultdict
from datetime import date,timedelta
from pathlib import Path
from generate import generate
from query_known_plans import query

SCRIPT=Path(__file__).resolve()
ROOT=next((p for p in SCRIPT.parents if (p/'server/contracts.ts').exists()),SCRIPT.parents[2])
OUT=SCRIPT.parent.parent if SCRIPT.parent.name=='generators' else ROOT/'outputs/isolated-synthetic-20261004'
checks=[]
def check(name,condition):
 if not condition:raise AssertionError(name)
 checks.append(name)

def main():
 manifest=json.loads((OUT/'manifest.json').read_text());d=json.loads((OUT/'normal/source-records.json').read_text());expected=json.loads((OUT/'expected-results.json').read_text())
 check('isolated business identity',manifest['businessId']=='neo-sim-acceptance-20261004' and manifest['dataNature']=='demo')
 ids={k:{r['id'] for r in d[k]} for k in ['products','product_roles','skus','channels','warehouses','customers']}
 check('four products, three roles, two channels and two warehouses',(len(ids['products']),len(ids['product_roles']),len(ids['channels']),len(ids['warehouses']))==(4,3,2,2))
 sku_product={r['id']:r['product_id'] for r in d['skus']}
 for table,rows in d.items():
  key='source_record_id' if rows and 'source_record_id' in rows[0] else 'id' if rows and 'id' in rows[0] else None
  if key:check(table+' unique primary keys',len({r[key] for r in rows})==len(rows))
  for index,r in enumerate(rows):
   if 'business_id' in r:check(f'{table} {index} isolated business',r['business_id']==manifest['businessId'] and r['data_nature']=='SYNTHETIC_DEMO')
   for key,target in [('product_id','products'),('sku_id','skus'),('channel','channels'),('channel_id','channels'),('warehouse_id','warehouses'),('contact_id','customers'),('customer_id','customers')]:
    if key in r and r[key] not in ('',None):check(f'{table} {index} {key} exists',r[key] in ids[target])
   if r.get('sku_id') and r.get('product_id'):check(f'{table} {index} SKU product agrees',sku_product[r['sku_id']]==r['product_id'])
 for table in ('events','orders','inventory','expenses'):
  check(table+' source IDs use sim prefix',all(r['source_record_id'].startswith('sim-') for r in d[table]))
  check(table+' integer non-negative source values',all(isinstance(v,int) and not isinstance(v,bool) and v>=0 for r in d[table] for k,v in r.items() if k in ('quantity','amount_cents','variable_cost_cents','sellable_units','inventory_cost_cents','in_transit_units','safety_units')))
 for entry in manifest['importBatches']:
  raw=(OUT/entry['file']).read_bytes()
  with (OUT/entry['file']).open(newline='') as f:rows=list(csv.DictReader(f))
  check(entry['file']+' row limit',len(rows)==entry['rows'] and len(rows)<=1000)
  check(entry['file']+' byte limit',len(raw)==entry['bytes'] and len(raw)<=1048576)
  check(entry['file']+' coverage valid',all(entry['coverageStart']<=r['occurred_at'][:10]<=entry['coverageEnd'] for r in rows))
 for kind in ('events','orders','inventory','expenses'):
  check(kind+' normal import counts exactly cover raw',sum(b['rows'] for b in manifest['importBatches'] if b['kind']==kind)==len(d[kind]))
 dbs={n:sqlite3.connect(f'file:{OUT/"databases"/(n+".sqlite")}?mode=ro',uri=True) for n in ('people','goods','market')}
 p,g,m=(dbs[n] for n in ('people','goods','market'))
 for n,db in dbs.items():
  check(n+' SQLite integrity',db.execute('PRAGMA integrity_check').fetchone()[0]=='ok')
  check(n+' SQLite foreign keys',not list(db.execute('PRAGMA foreign_key_check')))
  restored=sqlite3.connect(':memory:');restored.executescript((OUT/f'databases/{n}.sql').read_text())
  for table, in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall():
   check(n+'.'+table+' SQL restore',list(db.execute(f'SELECT * FROM {table} ORDER BY 1'))==list(restored.execute(f'SELECT * FROM {table} ORDER BY 1')))
  restored.close()
 for n in ('goods','market'):
  for table in ('products','skus','product_roles','channels','warehouses','businesses'):
   check(n+'.'+table+' shared masters consistent',list(dbs[n].execute(f'SELECT * FROM {table} ORDER BY id'))==list(p.execute(f'SELECT * FROM {table} ORDER BY id')))
 source={r['source_record_id']:r for r in d['orders']};event={r['source_record_id']:r for r in d['events']};paid={(r['order_id'],r['order_line_id']):r for r in d['orders'] if r['entry_type']=='paid'}
 link={r['source_record_id']:r for r in d['order_customer_links']}
 check('every order/refund has one sidecar link',set(link)==set(source))
 refunds=defaultdict(lambda:dict(quantity=0,amount=0,cost=0))
 for row in d['orders']:
  rid=row['source_record_id'];relation=link[rid];intent=event[relation['event_intent_id']]
  check(rid+' intent customer/channel/product/time',intent['contact_id']==relation['customer_id'] and intent['channel']==row['channel'] and intent['product_id']==row['product_id'] and intent['occurred_at']<row['occurred_at'])
  check(rid+' original paid line link',relation['paid_source_record_id']==paid[(row['order_id'],row['order_line_id'])]['source_record_id'])
  if row['entry_type']=='refund':
   origin=paid[(row['order_id'],row['order_line_id'])];check(rid+' refund follows payment',row['occurred_at']>origin['occurred_at'])
   sums=refunds[(row['order_id'],row['order_line_id'])];sums['quantity']+=row['quantity'];sums['amount']+=row['amount_cents'];sums['cost']+=row['variable_cost_cents']
 for key,sums in refunds.items():check(str(key)+' refunds bounded',sums['quantity']<=paid[key]['quantity'] and sums['amount']<=paid[key]['amount_cents'] and sums['cost']<=paid[key]['variable_cost_cents'])
 # Reconstruct daily physical stock only from independent ledger deltas.
 state=defaultdict(int);ledgers=defaultdict(list)
 for row in d['inventory_ledger']:
  key=(row['warehouse_id'],row['sku_id']);check(row['id']+' ledger continuity',state[key]==row['before_units'] and row['before_units']+row['delta_units']==row['after_units'] and row['after_units']>=0)
  state[key]=row['after_units'];ledgers[key].append(row)
 for inv in d['inventory']:
  key=(inv['warehouse_id'],inv['sku_id']);rows=[r for r in ledgers[key] if r['business_date']<=inv['occurred_at'][:10]]
  check(inv['source_record_id']+' independently balanced stock',sum(r['delta_units'] for r in rows)==inv['sellable_units'])
  cost=next(p['unit_inventory_cost_cents'] for p in d['products'] if p['id']==inv['product_id'])
  check(inv['source_record_id']+' inventory valuation',inv['inventory_cost_cents']==inv['sellable_units']*cost)
 for row in d['orders']:
  movements=[r for r in d['inventory_ledger'] if r['reference_id']==row['source_record_id']]
  wanted=-row['quantity'] if row['entry_type']=='paid' else link[row['source_record_id']]['restock_units']
  check(row['source_record_id']+' stock movement agrees',sum(r['delta_units'] for r in movements)==wanted)
 dates=sorted({r['occurred_at'][:10] for r in d['inventory']})
 check('24 complete weekly snapshots plus as-of',dates==[(date(2026,4,6)+timedelta(weeks=i,days=6)).isoformat() for i in range(24)]+['2026-09-24'])
 check('16 SKU/warehouse combinations every stock date',all(sum(r['occurred_at'][:10]==day for r in d['inventory'])==16 for day in dates))
 for key,value in expected['periods'].items():
  lo,hi,at=value['periodStart'],value['periodEnd'],value['asOf'];condition='substr(occurred_at,1,10)>=? AND substr(occurred_at,1,10)<=?'
  financial=p.execute(f'''SELECT COUNT(DISTINCT CASE WHEN entry_type='paid' THEN order_id END),SUM(CASE entry_type WHEN 'paid' THEN amount_cents ELSE -amount_cents END),SUM(CASE entry_type WHEN 'paid' THEN variable_cost_cents ELSE -variable_cost_cents END) FROM orders WHERE {condition}''',(lo,hi)).fetchone()
  spend=m.execute(f'SELECT SUM(amount_cents) FROM expenses WHERE {condition}',(lo,hi)).fetchone()[0]
  f=value['financial'];check(key+' independent SQL financial',financial==(f['paidOrders'],f['netRevenueCents'],f['variableCostCents']) and spend==f['spendCents'] and financial[1]-financial[2]-spend==f['contributionMarginCents'])
  for stage,event_types in [('A1',['content_view']),('A2',['engaged','click']),('A3',['inquiry']),('A5',['relationship'])]:
   marks=','.join('?' for _ in event_types)
   raw,unique=p.execute(f'SELECT SUM(quantity),COUNT(DISTINCT contact_id) FROM events WHERE {condition} AND event_type IN ({marks})',(lo,hi,*event_types)).fetchone()
   check(key+' '+stage+' raw events',raw==value['events'][stage])
   if stage!='A5':check(key+' '+stage+' independent customer dedup',unique==value['customerFunnel']['stageDistinctCustomers'][stage])
  a4=p.execute('''WITH remaining AS (SELECT order_id,order_line_id,SUM(CASE entry_type WHEN 'paid' THEN quantity ELSE -quantity END) q FROM orders WHERE substr(occurred_at,1,10)<=? GROUP BY order_id,order_line_id) SELECT COUNT(DISTINCT l.customer_id) FROM orders o JOIN remaining r USING(order_id,order_line_id) JOIN order_customer_links l ON l.source_record_id=o.source_record_id WHERE o.entry_type='paid' AND substr(o.occurred_at,1,10)>=? AND substr(o.occurred_at,1,10)<=? AND r.q>0''',(at,lo,hi)).fetchone()[0]
  check(key+' independently linked retained A4',a4==value['customerFunnel']['cohortA4'])
  stages=value['customerFunnel']['stageDistinctCustomers'];check(key+' cohort funnel monotone',stages['A1']>=stages['A2']>=stages['A3']>=a4)
 for cutoff in expected['forecastCutoffs']:
  plans=query(OUT,cutoff['asOf']);check(cutoff['asOf']+' SQL point-in-time plans equal independent CSV oracle',plans==cutoff['openPlansKnownAtCutoff'])
  check(cutoff['asOf']+' no future revision',all(r['known_at'][:10]<=cutoff['asOf'] for r in plans))
 # All recorded in-transit stock reconciles open plan balances known at that inventory date.
 for day in dates:
  plans=query(OUT,day);open_units=defaultdict(int)
  for r in plans:open_units[(r['warehouse_id'],r['sku_id'])]+=r['remaining_units']
  for r in [r for r in d['inventory'] if r['occurred_at'][:10]==day]:check(r['source_record_id']+' plan transit reconciliation',r['in_transit_units']==open_units[(r['warehouse_id'],r['sku_id'])])
 cases=json.loads((OUT/'counterexamples/cases.json').read_text())
 for case_id in ('cross-enterprise-sku','product-sku-mismatch'):
  case=next(c for c in cases if c['id']==case_id)
  with (OUT/case['file']).open(newline='') as f:row=next(csv.DictReader(f))
  check(case_id+' independently rejected by association rules',row['sku_id'] not in sku_product or sku_product[row['sku_id']]!=row['product_id'])
 check('counterexamples physically separate',all(not c.get('file','').startswith('normal/') for c in cases))
 check('normal baseline excludes negative primary keys',all('sim-NEG' not in str(r) for rows in d.values() for r in rows))
 check('no personal identifying data',all(set(c)=={'id','synthetic_label','created_at','business_id','data_nature'} for c in d['customers']))
 check('market context marked fiction',all(r['verification_status']=='fictional' and r['historical_eligible'] is False and '无真实' in r['source'] for r in d['fictional_market_events']))
 manual=expected['manualChecks']['customerDedup'];events=manual['input'];check('hand calculation distinct vs repeated events',sum(s=='A1' for s,c in events)==3 and len({c for s,c in events if s=='A1'})==2 and len({c for s,c in events if s=='A3'})==1)
 check('manual inventory warehouse denominator',expected['manualChecks']['financial']['supplyRatio']==0.5)
 # Regeneration is a second output inside this checkout; excludes reports/runtime and manifests.
 with tempfile.TemporaryDirectory(prefix='synthetic-repro-',dir=OUT.parent) as tmp:
  replica=Path(tmp);generate(replica)
  selected=[p for p in OUT.rglob('*') if p.is_file() and (str(p.relative_to(OUT)).startswith(('normal/','databases/','counterexamples/')) or p.name in ('design.json','manual-fixture.json'))]
  for path in selected:
   other=replica/path.relative_to(OUT);check(str(path.relative_to(OUT))+' seed reproducibility',other.exists() and hashlib.sha256(path.read_bytes()).digest()==hashlib.sha256(other.read_bytes()).digest())
 for db in dbs.values():db.close()
 report={'status':'passed','checkCount':len(checks),'checks':checks,'scope':'independent CSV/SQL arithmetic, FK/cross-domain lineage, stock ledger and known-at plans; synthetic only','scenarioObservations':expected['scenarioObservations']}
 (OUT/'reports').mkdir(exist_ok=True);(OUT/'reports/quality-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'status':'passed','checkCount':len(checks)}))

if __name__=='__main__':main()
