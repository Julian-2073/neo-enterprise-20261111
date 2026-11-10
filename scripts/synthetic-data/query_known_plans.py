"""Point-in-time arrival view. Future receipts and future revisions are excluded."""
import argparse
import json
import sqlite3
from pathlib import Path
SCRIPT=Path(__file__).resolve()
ROOT=next((p for p in SCRIPT.parents if (p/'server/contracts.ts').exists()),SCRIPT.parents[2])
DEFAULT=SCRIPT.parent.parent if SCRIPT.parent.name=='generators' else ROOT/'outputs/isolated-synthetic-20261004'

def query(output,as_of):
 db=sqlite3.connect(f'file:{Path(output)/"databases/goods.sqlite"}?mode=ro',uri=True);db.row_factory=sqlite3.Row
 cutoff=as_of+'T23:59:59+08:00'
 rows=db.execute('''WITH known AS (
   SELECT *,ROW_NUMBER() OVER(PARTITION BY plan_id ORDER BY version DESC) rn
   FROM arrival_plan_versions WHERE known_at<=?
 ), received AS (
   SELECT plan_id,SUM(units) received_units FROM arrival_receipts
   WHERE received_at<=? AND known_at<=? GROUP BY plan_id
 ) SELECT k.plan_id,k.version,k.known_at,k.planned_eta,k.units,k.warehouse_id,k.sku_id,k.product_id,
   k.status,k.business_id,k.data_nature,k.units-COALESCE(r.received_units,0) remaining_units
 FROM known k LEFT JOIN received r USING(plan_id)
 WHERE rn=1 AND k.units-COALESCE(r.received_units,0)>0 ORDER BY k.plan_id''',(cutoff,cutoff,cutoff)).fetchall()
 result=[dict(r) for r in rows];db.close();return result

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=DEFAULT);p.add_argument('--as-of',required=True);args=p.parse_args()
 print(json.dumps({'asOf':args.as_of,'availability':'synthetic_business_known_at; distinct from system import time','plans':query(args.output,args.as_of)},ensure_ascii=False,indent=2))
