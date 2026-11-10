"""Read the supplied synthetic SQLite sources without modifying them; export domain facts only."""
import sqlite3,json,sys
from pathlib import Path
root=Path(sys.argv[1]); out=Path(sys.argv[2])
con=sqlite3.connect(f'file:{root / "databases/goods.sqlite"}?mode=ro',uri=True);con.row_factory=sqlite3.Row
records=[]
for table,kind in [('products','products'),('skus','skus'),('product_roles','roles')]:
 for row in con.execute('SELECT * FROM '+table):
  r=dict(row);payload=json.loads(r['payload']) if 'payload' in r else r
  # Keep product identities and purpose; do not import preset compliance forecasts.
  allowed={'id','name','roleId','role_id','product_id','rolePurpose','provenance'}
  records.append({'id':r['id'],'kind':kind,'payload':{k:v for k,v in payload.items() if k in allowed}})
for row in con.execute('SELECT i.*,p.eta FROM inventory_snapshots i JOIN products p ON p.id=i.product_id WHERE i.occurred_at=(SELECT max(j.occurred_at) FROM inventory_snapshots j WHERE j.sku_id=i.sku_id AND j.warehouse_id=i.warehouse_id)'):
 r=dict(row)
 if r['in_transit_units'] and r['eta']:
  ident='arrival-'+r['id'];records.append({'id':ident,'kind':'arrivals','payload':{'id':ident,'skuId':r['sku_id'],'warehouseId':r['warehouse_id'],'units':r['in_transit_units'],'date':r['eta'],'sourceRecordId':r['id']}})
out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps({'dataNature':'demo','records':records},ensure_ascii=False,indent=2))
print('Exported synthetic domain facts:',len(records))
