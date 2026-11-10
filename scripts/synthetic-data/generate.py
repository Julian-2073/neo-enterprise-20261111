"""Seeded, causal-in-time operating simulation; all identifiers are isolated fixtures.

No product code, existing DB, model or network is used. Expected results are
computed separately by oracle.py, not read from the product under test.
"""
import argparse
import csv
import hashlib
import json
import random
import sqlite3
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

SCRIPT = Path(__file__).resolve()
ROOT = next((p for p in SCRIPT.parents if (p/'server/contracts.ts').exists()), SCRIPT.parents[2])
DEFAULT = SCRIPT.parent.parent if SCRIPT.parent.name=='generators' else ROOT / 'outputs/isolated-synthetic-20261004'
BID = 'neo-sim-acceptance-20261004'
START = date(2026, 4, 6)
END = date(2026, 9, 20)
ASOF = date(2026, 9, 24)
SEED = 20261004

HEADERS = {
 'events':['source_record_id','occurred_at','event_type','channel','quantity','product_id','contact_id'],
 'orders':['source_record_id','order_id','order_line_id','entry_type','occurred_at','channel','product_id','sku_id','quantity','amount_cents','variable_cost_cents'],
 'inventory':['source_record_id','occurred_at','warehouse_id','product_id','sku_id','sellable_units','inventory_cost_cents','in_transit_units','safety_units'],
 'expenses':['source_record_id','occurred_at','channel','amount_cents','product_id','sku_id'],
}

def stamp(day, hour=8):
 return f'{day.isoformat()}T{hour:02}:00:00+08:00'

def csv_write(path, rows, headers=None):
 path.parent.mkdir(parents=True, exist_ok=True)
 columns = headers or (list(rows[0]) if rows else ['id'])
 with path.open('w', newline='', encoding='utf-8') as f:
  w = csv.DictWriter(f, fieldnames=columns); w.writeheader(); w.writerows(rows)

def json_write(path, value):
 path.parent.mkdir(parents=True, exist_ok=True)
 path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

def generate(output=DEFAULT):
 output=Path(output).resolve()
 assert output.is_relative_to((ROOT/'outputs').resolve()) and output != (ROOT/'outputs').resolve(), 'Generated fixtures must stay under outputs, never overwrite source or business databases'
 rng=random.Random(SEED)
 products=[]
 for code,name,role,price,cost,target,safety in [
  ('M1','可调节哑铃 M1','entry',69900,33000,12,3),
  ('R1','家用划船机 R1','core',219900,126000,9,4),
  ('S2','智能跑步机 S2','core',499900,295000,9,3),
  ('X2','旗舰跑步机 X2','flagship',1299900,780000,5,1)]:
  products.append(dict(id='sim-'+code,display_code=code,name=name,role_id=role,list_price_cents=price,unit_inventory_cost_cents=cost,fulfilment_per_unit_cents=2000,target_units_per_sku=target,safety_units_per_sku=safety,business_id=BID,data_nature='SYNTHETIC_DEMO',known_at=stamp(START-timedelta(days=7))))
 roles=[dict(id=r,name=n,purpose=p,external_id='sim-role-'+r,supply_target_ratio=0.8,business_id=BID,data_nature='SYNTHETIC_DEMO') for r,n,p in [('entry','入门品','首购承接'),('core','主力成交品','核心成交与供给承接'),('flagship','旗舰形象品','高价需求及品牌形象')]]
 channels=[dict(id='sim-douyin',name='抖音模拟店铺',business_id=BID,data_nature='SYNTHETIC_DEMO'),dict(id='sim-tmall',name='天猫模拟店铺',business_id=BID,data_nature='SYNTHETIC_DEMO')]
 warehouses=[dict(id='sim-W-east',name='模拟东仓',business_id=BID,data_nature='SYNTHETIC_DEMO'),dict(id='sim-W-west',name='模拟西仓',business_id=BID,data_nature='SYNTHETIC_DEMO')]
 skus=[dict(id=f'{p["id"]}-S{k}',product_id=p['id'],role_id=p['role_id'],name=f'{p["name"]} 模拟规格{k}',business_id=BID,data_nature='SYNTHETIC_DEMO') for p in products for k in (1,2)]
 customers=[dict(id=f'sim-C-{i:04}',synthetic_label=f'合成客户 {i:04}',created_at=stamp(START-timedelta(days=1)),business_id=BID,data_nature='SYNTHETIC_DEMO') for i in range(1,241)]
 pmap={p['id']:p for p in products}; smap={s['id']:s for s in skus}
 events=[];orders=[];expenses=[];inventory=[];links=[];attempts=[];ledger=[];plans=[];receipts=[];budgets=[];weekly=[]
 stocks={}; pending=[]; refund_queue=[]; order_number=0
 def movement(day,wh,sku,delta,reason,ref,known_at=None):
  before=stocks[(wh,sku)];after=before+delta
  assert after>=0
  stocks[(wh,sku)]=after
  ledger.append(dict(id=f'sim-LG-{len(ledger)+1:06}',business_date=day.isoformat(),warehouse_id=wh,sku_id=sku,delta_units=delta,before_units=before,after_units=after,reason=reason,reference_id=ref,known_at=known_at or stamp(day),business_id=BID,data_nature='SYNTHETIC_DEMO'))
 for s in skus:
  for wh in warehouses:
   # Starting stock is an input assumption, not adjusted to hit metric targets.
   n=pmap[s['product_id']]['target_units_per_sku']//2
   stocks[(wh['id'],s['id'])]=0
   movement(START-timedelta(days=1),wh['id'],s['id'],n,'opening','sim-opening')
 def event(day,kind,cid,pid,ch,hour):
  rid=f'sim-E-{len(events)+1:06}'
  events.append(dict(source_record_id=rid,occurred_at=stamp(day,hour),event_type=kind,channel=ch,quantity=1,product_id=pid,contact_id=cid))
  return rid
 def make_plan(day,wh,s,qty):
  ident=f'sim-PL-{len(pending)+1:04}'
  normal_eta=day+timedelta(days=14 if s['product_id']!='sim-X2' else 21)
  # R1 supplier capacity interruption is an exogenous fixture parameter.
  disruption=s['product_id']=='sim-R1' and 13 <= (day-START).days//7 <= 17
  actual_eta=normal_eta+timedelta(days=21 if disruption else 0)
  plan=dict(id=ident,warehouse_id=wh,sku_id=s['id'],product_id=s['product_id'],units=qty,created_day=day.isoformat(),receipt_day=actual_eta.isoformat(),received=False,revision_day=(day+timedelta(days=7)).isoformat() if disruption else None,normal_eta=normal_eta.isoformat())
  pending.append(plan)
  plans.append(dict(plan_id=ident,version=1,known_at=stamp(day,7),planned_eta=normal_eta.isoformat(),units=qty,warehouse_id=wh,sku_id=s['id'],product_id=s['product_id'],status='planned',business_id=BID,data_nature='SYNTHETIC_DEMO'))
 def snapshot(day):
  for s in skus:
   p=pmap[s['product_id']]
   for wi,wh in enumerate(warehouses):
    # Target is a SKU-wide minimum, disjointly allocated across two warehouses.
    safety=p['safety_units_per_sku']//2+(wi < p['safety_units_per_sku']%2)
    in_transit=sum(x['units'] for x in pending if x['sku_id']==s['id'] and x['warehouse_id']==wh['id'] and not x['received'] and x['created_day']<=day.isoformat())
    quantity=stocks[(wh['id'],s['id'])]
    inventory.append(dict(source_record_id=f'sim-I-{day}-{wh["id"]}-{s["id"]}',occurred_at=stamp(day,23),warehouse_id=wh['id'],product_id=p['id'],sku_id=s['id'],sellable_units=quantity,inventory_cost_cents=quantity*p['unit_inventory_cost_cents'],in_transit_units=in_transit,safety_units=int(safety)))
 for offset in range((ASOF-START).days+1):
  day=START+timedelta(days=offset); wi=offset//7
  for plan in pending:
   if plan['revision_day']==day.isoformat():
    plans.append(dict(plan_id=plan['id'],version=2,known_at=stamp(day,7),planned_eta=plan['receipt_day'],units=plan['units'],warehouse_id=plan['warehouse_id'],sku_id=plan['sku_id'],product_id=plan['product_id'],status='rescheduled',business_id=BID,data_nature='SYNTHETIC_DEMO'))
   if not plan['received'] and plan['receipt_day']==day.isoformat():
    plan['received']=True
    rid=f'sim-RC-{len(receipts)+1:04}'
    receipts.append(dict(id=rid,plan_id=plan['id'],received_at=stamp(day,8),warehouse_id=plan['warehouse_id'],sku_id=plan['sku_id'],units=plan['units'],known_at=stamp(day,8),business_id=BID,data_nature='SYNTHETIC_DEMO'))
    movement(day,plan['warehouse_id'],plan['sku_id'],plan['units'],'receipt',rid)
  for refund in refund_queue:
   if refund['day']!=day:
    continue
   paid=refund['paid'];cancel=refund['cancel'];rid=f'sim-REF-{len(orders)+1:06}'
   row={**paid,'source_record_id':rid,'entry_type':'refund','occurred_at':stamp(day,8),'variable_cost_cents':paid['variable_cost_cents'] if cancel else 0}
   orders.append(row)
   links.append(dict(source_record_id=rid,order_id=row['order_id'],order_line_id=row['order_line_id'],customer_id=refund['customer'],paid_source_record_id=paid['source_record_id'],event_intent_id=refund['intent'],warehouse_id=refund['wh'],refund_reason='cancel_before_dispatch' if cancel else 'returned_unsellable',restock_units=row['quantity'] if cancel else 0,known_at=stamp(day,8),business_id=BID,data_nature='SYNTHETIC_DEMO'))
   if cancel: movement(day,refund['wh'],row['sku_id'],row['quantity'],'cancel_restock',rid,stamp(day,8))
  if day<=END and day.weekday()==0:
   demand_factor=1.0 if wi<8 else 1.0+0.075*(wi-7) if wi<16 else 1.6
   budget_multiplier=1.0 if wi<20 else 1.25
   pool=rng.sample(customers,round(28*demand_factor*budget_multiplier**0.5))
   weekly.append(dict(week_index=wi+1,start=day.isoformat(),end=(day+timedelta(days=6)).isoformat(),scenario_input='stable' if wi<8 else 'demand_growth' if wi<16 else 'supplier_delay' if wi<20 else 'budget_increase',demand_factor=demand_factor,budget_multiplier=budget_multiplier))
   # Spend is planned before this week's realized customer responses.
   for ci,ch in enumerate(channels):
    budget=round((55000 if ci==0 else 40000)*budget_multiplier)
    budgets.append(dict(id=f'sim-B-{wi+1}-{ch["id"]}',week_index=wi+1,channel_id=ch['id'],budget_cents=budget,known_at=stamp(day,7),business_id=BID,data_nature='SYNTHETIC_DEMO'))
    weights=[2,4,3,1];allocated=[budget*w//10 for w in weights];allocated[-1]+=budget-sum(allocated)
    for p,amount in zip(products,allocated):
     expenses.append(dict(source_record_id=f'sim-XP-{wi+1}-{ch["id"]}-{p["id"]}',occurred_at=stamp(day,7),channel=ch['id'],amount_cents=amount,product_id=p['id'],sku_id=''))
   # Reorder every second week, using on-hand and outstanding purchase plans only.
   if wi%2==0:
    for s in skus:
     p=pmap[s['product_id']]
     outstanding=sum(x['units'] for x in pending if x['sku_id']==s['id'] and not x['received'])
     total=sum(stocks[(wh['id'],s['id'])] for wh in warehouses)
     qty=max(0,p['target_units_per_sku']-total-outstanding)
     if qty:
      wh=min(warehouses,key=lambda x:stocks[(x['id'],s['id'])])['id'];make_plan(day,wh,s,qty)
   for c in pool:
    pid=rng.choices([p['id'] for p in products],weights=[0.30,0.38,0.24,0.08])[0]
    ch=rng.choices([x['id'] for x in channels],weights=[0.58,0.42])[0]
    # All stages/orders happen within the same complete week, in time order.
    when=day+timedelta(days=rng.randrange(6));cid=c['id']
    event(when,'content_view',cid,pid,ch,9)
    if rng.random()>0.65:continue
    event(when,'engaged',cid,pid,ch,10)
    if rng.random()<0.20:event(when,'click',cid,pid,ch,10)  # genuine distinct repeat event
    if rng.random()>0.60:continue
    intent=event(when,'inquiry',cid,pid,ch,11)
    if rng.random()>0.72:continue
    sku=rng.choice([s for s in skus if s['product_id']==pid])['id']
    attempt_id=f'sim-D-{len(attempts)+1:05}'
    # Purchasing is settled in the later daily loop, never by decrementing future stock today.
    attempts.append(dict(id=attempt_id,date=when.isoformat(),customer_id=cid,product_id=pid,sku_id=sku,channel_id=ch,intent_event_id=intent,wanted_units=1+(rng.random()<0.10),fulfilled_units=None,reason='scheduled',business_id=BID,data_nature='SYNTHETIC_DEMO'))
  if day<=END:
   for attempt in attempts:
    if attempt['date']!=day.isoformat() or attempt['reason']!='scheduled':continue
    sku=attempt['sku_id'];pid=attempt['product_id'];cid=attempt['customer_id'];ch=attempt['channel_id'];p=pmap[pid]
    candidates=[wh['id'] for wh in warehouses if stocks[(wh['id'],sku)]>0]
    if not candidates:
     attempt['fulfilled_units']=0;attempt['reason']='stockout';continue
    wh=max(candidates,key=lambda x:stocks[(x,sku)])
    quantity=min(int(attempt['wanted_units']),stocks[(wh,sku)])
    attempt['fulfilled_units']=quantity;attempt['reason']='fulfilled' if quantity==attempt['wanted_units'] else 'partially_fulfilled'
    order_number+=1;oid=f'sim-O-{order_number:05}'
    price=p['list_price_cents']*rng.choice([100,100,95])//100
    multiline=quantity==2 and rng.random()<0.5
    for li,qty in enumerate([1,1] if multiline else [quantity],1):
     rid=f'sim-PAY-{order_number:05}-{li}'
     row=dict(source_record_id=rid,order_id=oid,order_line_id=f'L{li}',entry_type='paid',occurred_at=stamp(day,12),channel=ch,product_id=pid,sku_id=sku,quantity=qty,amount_cents=price*qty,variable_cost_cents=(p['unit_inventory_cost_cents']+p['fulfilment_per_unit_cents'])*qty)
     orders.append(row)
     links.append(dict(source_record_id=rid,order_id=oid,order_line_id=row['order_line_id'],customer_id=cid,paid_source_record_id=rid,event_intent_id=attempt['intent_event_id'],warehouse_id=wh,refund_reason='',restock_units=0,known_at=stamp(day,12),business_id=BID,data_nature='SYNTHETIC_DEMO'))
     movement(day,wh,sku,-qty,'paid_allocation',rid,stamp(day,12))
     if rng.random()<0.10:
      cancel=rng.random()<0.45
      refund_queue.append(dict(day=day+timedelta(days=1 if cancel else 9),paid=row,cancel=cancel,customer=cid,intent=attempt['intent_event_id'],wh=wh))
    if rng.random()<0.3:event(day,'relationship',cid,pid,ch,17)
  if day.weekday()==6 and day<=END or day==ASOF:snapshot(day)
 # Flatten data to independent side tables; do not expose internal actual_eta on plan versions.
 facts={'events':events,'orders':sorted(orders,key=lambda r:(r['occurred_at'],r['entry_type']!='paid',r['source_record_id'])),'inventory':inventory,'expenses':expenses}
 # Receipts/replenishment/cancellations are chronological. Events scheduled earlier retain their business time.
 market_events=[dict(id='sim-MK-1',observed_at=stamp(START+timedelta(weeks=10)),title='虚构：居家有氧讨论活动样例',kind='fictional_demand_context',source='AI合成情境，无真实URL或新闻',verification_status='fictional',historical_eligible=False,business_id=BID,data_nature='SYNTHETIC_DEMO'),dict(id='sim-MK-2',observed_at=stamp(START+timedelta(weeks=19)),title='虚构：竞争品牌A促销情境',kind='fictional_competitor_context',source='AI合成情境，无真实URL或新闻',verification_status='fictional',historical_eligible=False,business_id=BID,data_nature='SYNTHETIC_DEMO')]
 masters={'businesses':[dict(id=BID,name='NEO 隔离模拟企业',data_nature='SYNTHETIC_DEMO',timezone='Asia/Shanghai')],'products':products,'product_roles':roles,'skus':skus,'channels':channels,'warehouses':warehouses,'customers':customers}
 sidecars={'order_customer_links':links,'demand_attempts':attempts,'inventory_ledger':ledger,'arrival_plan_versions':plans,'arrival_receipts':receipts,'channel_budgets':budgets,'fictional_market_events':market_events}
 rows_by_name={**masters,**facts,**sidecars}
 for table,rows in rows_by_name.items():csv_write(output/f'normal/{"master" if table in masters else "sidecars" if table in sidecars else "raw"}/{table}.csv',rows,HEADERS.get(table))
 json_write(output/'normal/source-records.json',rows_by_name)
 json_write(output/'design.json',dict(seed=SEED,businessId=BID,businessName='NEO 隔离模拟企业',dataNature='demo',dataLabel='SYNTHETIC_DEMO',periodStart=str(START),periodEnd=str(END),asOf=str(ASOF),weeks=weekly,model='Nested person events + availability-constrained orders + scheduled supply + dated refunds; no metric target fitting',stockOpeningDate='2026-04-05',settlement='integer CNY cents; refund posted on refund business day',supplyQualification='SKU total across both warehouses >= SKU aggregate safety; distinct SKU denominator; 80% configured target',scenarioInputs={'weeks1_8':'stable demand parameter','weeks9_16':'gradual exogenous demand parameter increase','weeks14_18':'new R1 replenishment plans announced late by 21 days one week after creation','weeks21_24':'planned ad budget +25%; exposure scale sqrt(multiplier)','refund_probability_per_paid_line':0.10},limitations=['Simulated mechanism is not a verified cause in real business.','240 anonymous customer tokens; no names/phones/emails.','Demand exposure plans are scheduled weekly; stock fulfillment settles daily.','No actual forecast or action result fabricated.']))
 # Four-week batches give each source a continuous declared interval, <=1,000 rows/1MiB.
 batches=[]
 for kind,rows in facts.items():
  for block in range(6):
   lo=START+timedelta(weeks=block*4);hi=min(END,lo+timedelta(days=27))
   if kind in ('orders','inventory') and block==5:hi=ASOF
   subset=[r for r in rows if lo.isoformat()<=r['occurred_at'][:10]<=hi.isoformat()]
   assert subset
   for part,at in enumerate(range(0,len(subset),1000),1):
    filename=f'normal/imports/{kind}-{block+1:02}-{part:02}.csv';chunk=subset[at:at+1000]
    csv_write(output/filename,chunk,HEADERS[kind]);size=(output/filename).stat().st_size
    assert size<=1048576
    batches.append(dict(kind=kind,file=filename,rows=len(chunk),bytes=size,coverageStart=str(lo),coverageEnd=str(hi),sourceName=f'SYNTHETIC_DEMO {BID} {kind}',dataNature='demo',templateVersion='1',businessId=BID))
 # Current ontology CSVs contain only supported properties; richer sidecar fields remain intact.
 ontology={
  'product':[dict(id=p['id'],name=p['name'],roleId=p['role_id']) for p in products],
  'sku':[dict(id=s['id'],name=s['name'],productId=s['product_id'],roleId=s['role_id']) for s in skus],
  'role':[dict(id=r['id'],name=r['name'],purpose=r['purpose']) for r in roles],
  'channel':[dict(id=c['id'],name=c['name']) for c in channels],
  'warehouse':[dict(id=w['id'],name=w['name']) for w in warehouses],
 }
 latest={}
 for v in sorted(plans,key=lambda v:(v['known_at'],v['version'])):latest[v['plan_id']]=v
 received_ids={r['plan_id'] for r in receipts}
 ontology['arrival']=[dict(id=v['plan_id'],skuId=v['sku_id'],warehouseId=v['warehouse_id'],date=v['planned_eta'],units=v['units']) for v in latest.values() if v['plan_id'] not in received_ids]
 for t,rows in ontology.items():csv_write(output/f'normal/ontology/{t}.csv',rows)
 # Cross-file relationships are tested independently; local scalar constraints remain explicit.
 kinds={
  'people':['customers','events','orders','order_customer_links','demand_attempts'],
  'goods':['inventory','inventory_ledger','arrival_plan_versions','arrival_receipts'],
  'market':['expenses','channel_budgets','fictional_market_events'],
 }
 common=['businesses','products','product_roles','skus','channels','warehouses']
 integers={'quantity','amount_cents','variable_cost_cents','sellable_units','inventory_cost_cents','in_transit_units','safety_units','list_price_cents','unit_inventory_cost_cents','fulfilment_per_unit_cents','target_units_per_sku','safety_units_per_sku','restock_units','wanted_units','fulfilled_units','delta_units','before_units','after_units','units','version','budget_cents','week_index'}
 for domain,names in kinds.items():
  filename=output/f'databases/{domain}.sqlite';filename.parent.mkdir(parents=True,exist_ok=True)
  if filename.exists():filename.unlink()
  con=sqlite3.connect(filename);con.execute('PRAGMA foreign_keys=ON')
  con.execute('CREATE TABLE fixture_meta (business_id TEXT PRIMARY KEY, data_nature TEXT CHECK(data_nature=\'SYNTHETIC_DEMO\'), seed INTEGER, period_start TEXT, period_end TEXT, as_of TEXT)')
  con.execute('INSERT INTO fixture_meta VALUES(?,?,?,?,?,?)',(BID,'SYNTHETIC_DEMO',SEED,str(START),str(END),str(ASOF)))
  for table in common+names:
   rows=rows_by_name[table];cols=list(rows[0]);definitions=[]
   for key in cols:
    typ='INTEGER' if key in integers or key=='historical_eligible' else 'REAL' if key=='supply_target_ratio' else 'TEXT'
    constraint=' PRIMARY KEY' if key=='id' or key=='source_record_id' else ''
    if table=='arrival_plan_versions' and key=='plan_id':constraint=''
    definitions.append(f'{key} {typ}{constraint}')
   if table=='arrival_plan_versions':definitions.append('PRIMARY KEY(plan_id,version)')
   if 'product_id' in cols:definitions.append('FOREIGN KEY(product_id) REFERENCES products(id)')
   if 'sku_id' in cols:definitions.append('FOREIGN KEY(sku_id) REFERENCES skus(id)')
   if 'warehouse_id' in cols:definitions.append('FOREIGN KEY(warehouse_id) REFERENCES warehouses(id)')
   if 'channel' in cols:definitions.append('FOREIGN KEY(channel) REFERENCES channels(id)')
   if 'channel_id' in cols:definitions.append('FOREIGN KEY(channel_id) REFERENCES channels(id)')
   if 'contact_id' in cols:definitions.append('FOREIGN KEY(contact_id) REFERENCES customers(id)')
   if 'customer_id' in cols:definitions.append('FOREIGN KEY(customer_id) REFERENCES customers(id)')
   con.execute(f'CREATE TABLE {table} ({",".join(definitions)})')
   nullable_refs={'sku_id','product_id','channel','channel_id','warehouse_id','contact_id','customer_id'}
   con.executemany(f'INSERT INTO {table} VALUES({",".join("?" for _ in cols)})',[[None if c in nullable_refs and r[c]=='' else r[c] for c in cols] for r in rows])
  if domain=='people':con.executescript('''CREATE VIEW v_net_product_sales AS SELECT product_id,SUM(CASE entry_type WHEN 'paid' THEN quantity ELSE -quantity END) net_units,SUM(CASE entry_type WHEN 'paid' THEN amount_cents ELSE -amount_cents END) net_revenue_cents FROM orders GROUP BY product_id;''')
  if domain=='goods':con.executescript('''CREATE VIEW v_latest_inventory AS SELECT i.* FROM inventory i WHERE occurred_at=(SELECT MAX(occurred_at) FROM inventory x WHERE x.warehouse_id=i.warehouse_id AND x.sku_id=i.sku_id); CREATE VIEW v_current_sku AS SELECT sku_id,product_id,SUM(sellable_units) sellable_units,SUM(safety_units) safety_units,SUM(inventory_cost_cents) inventory_cost_cents,SUM(in_transit_units) in_transit_units FROM v_latest_inventory GROUP BY sku_id,product_id;''')
  if domain=='market':con.execute('CREATE VIEW v_spend AS SELECT channel,SUM(amount_cents) amount_cents FROM expenses GROUP BY channel')
  assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
  assert not list(con.execute('PRAGMA foreign_key_check'))
  con.commit();(output/f'databases/{domain}.sql').write_text('\n'.join(con.iterdump())+'\n');con.close()
 negatives=[]
 def counter(name,kind,rows,expectation,headers=None):
  f=f'counterexamples/{name}.csv';csv_write(output/f,rows,headers or HEADERS[kind]);negatives.append(dict(id=name,kind=kind,file=f,expectation=expectation))
 first_event=events[0];first_paid=next(r for r in orders if r['entry_type']=='paid')
 counter('exact-duplicate','events',[first_event],{'existingBackend':'ready; duplicate_count=1 after baseline; imported_count=0','quality':'not a new event'})
 counter('missing-required','events',[{k:v for k,v in first_event.items() if k!='event_type'}],{'existingBackend':'invalid'},[k for k in HEADERS['events'] if k!='event_type'])
 counter('missing-channel','events',[{**first_event,'source_record_id':'sim-NEG-channel','channel':''}],{'existingBackend':'invalid'})
 counter('negative-amount','orders',[{**first_paid,'source_record_id':'sim-NEG-money','amount_cents':-1}],{'existingBackend':'invalid'})
 counter('missing-cost','orders',[{**first_paid,'source_record_id':'sim-NEG-cost','order_id':'sim-NEG-O-cost','variable_cost_cents':''}],{'existingBackend':'ready; independent case snapshot margin null','classification':'valid partial, not malformed'})
 counter('cross-enterprise-sku','orders',[{**first_paid,'source_record_id':'sim-NEG-xref','order_id':'sim-NEG-O-xref','sku_id':'other-sim-R1-S1'}],{'existingBackend':'may accept scalar-valid row; relation validator must reject','requiredNewFieldPath':'tenant-aware master FK validation'})
 counter('product-sku-mismatch','orders',[{**first_paid,'source_record_id':'sim-NEG-prodsku','order_id':'sim-NEG-O-prodsku','product_id':'sim-X2'}],{'existingBackend':'may accept; independent relation validation rejects'})
 counter('unmatched-refund','orders',[{**first_paid,'source_record_id':'sim-NEG-refund','order_id':'sim-NEG-O-no-payment','entry_type':'refund'}],{'existingBackend':'invalid'})
 counter('content-conflict','events',[{**first_event,'quantity':2}],{'existingBackend':'invalid when same source baseline present'})
 counter('late-record','events',[{**first_event,'source_record_id':'sim-NEG-late','quantity':1}],{'existingBackend':'ready for separately declared old coverage; old snapshot immutable','business_known_at':'2026-10-04T12:00:00+08:00','notInNormalBaseline':True})
 counter('legitimate-zero-stock','inventory',[{**inventory[-1],'source_record_id':'sim-NEG-zero','occurred_at':stamp(ASOF+timedelta(days=1),23),'sellable_units':0,'inventory_cost_cents':0}],{'existingBackend':'ready; zero preserved; isolate from baseline'})
 json_write(output/'counterexamples/cases.json',negatives+[dict(id='version-conflict',kind='api',expectedStatus=409,body={'validationVersion':999}),dict(id='same-primary-new-master-version',kind='sidecar',payload={'id':'sim-R1','expectedVersion':999,'name':'不应覆盖'},expectation='contract fixture for data-ingestion line; immutable source expected'),dict(id='empty-channel-scope',kind='query',channel='sim-no-data',expectation='financial/events null, never inherit previous channel values')])
 json_write(output/'manual-fixture.json',{'source':'standalone hand-calculation, not product output','rows':{'orders':[{'order_id':'sim-H1','line':'L1','entry_type':'paid','quantity':2,'amount_cents':20000,'variable_cost_cents':12000},{'order_id':'sim-H1','line':'L2','entry_type':'paid','quantity':1,'amount_cents':5000,'variable_cost_cents':3000},{'order_id':'sim-H1','line':'L1','entry_type':'refund','quantity':1,'amount_cents':10000,'variable_cost_cents':6000}], 'expenses':[{'amount_cents':2000}],'inventory':[{'warehouse':'east','sku':'sim-HS1','sellable':2,'safety':2,'cost':4000},{'warehouse':'west','sku':'sim-HS1','sellable':3,'safety':3,'cost':6000},{'warehouse':'east','sku':'sim-HS2','sellable':0,'safety':1,'cost':0}]},'expected':{'paidOrders':1,'netUnits':2,'netRevenueCents':15000,'variableCostCents':9000,'spendCents':2000,'contributionMarginCents':4000,'inventoryCostCents':10000,'qualifiedSkuCount':1,'skuCount':2,'supplyRatio':0.5},'arithmetic':'20000+5000-10000=15000;12000+3000-6000=9000;15000-9000-2000=4000; SKU1 sums both warehouses once (5>=5), SKU2 fails (0<1)'})
 manifest={'schemaVersion':'isolated-synthetic-v1','businessId':BID,'businessName':'NEO 隔离模拟企业','dataNature':'demo','dataLabel':'SYNTHETIC_DEMO','seed':SEED,'periodStart':str(START),'periodEnd':str(END),'asOf':str(ASOF),'normalRecordCounts':{k:len(v) for k,v in rows_by_name.items()},'importBatches':batches,'ontologyImports':[{'typeId':t,'file':f'normal/ontology/{t}.csv','rows':len(rows),'definitionId':'neo-default-v1'} for t,rows in ontology.items() if rows],'notSupportedInFourTemplates':['customer master','order/customer linkage','plan version and business known_at','inventory ledger','market fiction','budget declarations','master revisions'],'dbs':[f'databases/{d}.sqlite' for d in kinds],'forbiddenBusinessIds':['neo-live-demo','demo-coca-fitness','test-a','test-b'],'tests':'all runtime writes use new synthetic tenant in this checkout only; no patrol/LLM/network'}
 manifest['files']={str(p.relative_to(output)):dict(sha256=hashlib.sha256(p.read_bytes()).hexdigest(),bytes=p.stat().st_size) for p in sorted(output.rglob('*')) if p.is_file() and p.name!='manifest.json' and '__pycache__' not in p.parts and not p.relative_to(output).parts[0].startswith('runtime')}
 json_write(output/'manifest.json',manifest)
 print(json.dumps({'output':str(output),'counts':manifest['normalRecordCounts'],'importBatches':len(batches),'factRows':sum(len(v) for v in facts.values()),'stockoutAttempts':sum(x['reason']=='stockout' for x in attempts)},ensure_ascii=False))
 return manifest

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=DEFAULT);args=parser.parse_args();generate(args.output)
