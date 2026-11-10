"""Field/key mapping and final handoff fingerprints, without changing product code."""
import csv
import hashlib
import json
import sqlite3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'outputs/isolated-synthetic-20261004'
def write(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
 m=json.loads((OUT/'manifest.json').read_text());source=json.loads((OUT/'normal/source-records.json').read_text());e=json.loads((OUT/'expected-results.json').read_text())
 units={'amount_cents':'人民币分','variable_cost_cents':'人民币分，退款行填成本回转额','inventory_cost_cents':'人民币分，当前可售库存成本','list_price_cents':'人民币分/件','unit_inventory_cost_cents':'人民币分/件','fulfilment_per_unit_cents':'人民币分/件','quantity':'事件次/商品件；依表区分','sellable_units':'件','in_transit_units':'件','safety_units':'件；仓库分配，SKU汇总后计算达标','delta_units':'件，允许负数','before_units':'件','after_units':'件','units':'件','budget_cents':'人民币分','supply_target_ratio':'0–1','version':'版本整数','known_at':'模拟业务知悉时间，ISO8601 +08:00；不是系统导入时间','occurred_at':'业务发生/观测时间，ISO8601 +08:00','customer_id':'匿名模拟客户主键','contact_id':'同 customers.id 的匿名模拟客户主键','business_id':'固定 neo-sim-acceptance-20261004','data_nature':'固定 SYNTHETIC_DEMO；接口使用 demo','planned_eta':'预测当时已知的计划日期，不是实际到货','received_at':'实际合成收货发生时间，不能提前用作预测特征','id':'表内主键，外部实体使用 sim 前缀；role.id 为固定枚举','source_record_id':'来源+模板范围内唯一；所有输入 sim 前缀'}
 grains={'events':'一次行为，可多次触发；客户人数需要去重','orders':'一笔支付或退款的订单明细分录','inventory':'某观测时间的一个仓库/SKU','expenses':'每周一个渠道/商品的广告费用','order_customer_links':'每条订单支付/退款分录一个客户、意向、仓库关联','demand_attempts':'一次意向后的购买尝试','arrival_plan_versions':'一笔补货计划的一个知悉版本','arrival_receipts':'一笔实际到货','inventory_ledger':'一个仓库/SKU的一次数量变动','channel_budgets':'每周/渠道的当周已知预算','customers':'一个匿名模拟客户','skus':'一个模拟SKU','products':'一个商品','product_roles':'一个固定角色','channels':'一个模拟渠道','warehouses':'一个模拟仓库','fictional_market_events':'一条虚构市场情境，不能作为真实检索证据','businesses':'一个隔离模拟企业'}
 fields=[]
 for table,rows in source.items():
  for field in rows[0]:
   v=next((r[field] for r in rows if r[field] is not None and r[field]!=''),None)
   fields.append({'table':table,'field':field,'type':'integer' if isinstance(v,int) and not isinstance(v,bool) else 'boolean' if isinstance(v,bool) else 'decimal' if isinstance(v,float) else 'string','grain':grains.get(table,''),'unit_or_meaning':units.get(field,'标识/说明，见来源和关联表'),'nullable':any(r[field] is None or r[field]=='' for r in rows),'example':v})
 with (OUT/'field-dictionary.csv').open('w',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(fields[0]));w.writeheader();w.writerows(fields)
 links=[
  ['events.contact_id','customers.id','many-to-one','same isolated business'],['events.product_id','products.id','many-to-one','same isolated business'],['orders.sku_id','skus.id','many-to-one','SKU product_id must equal order product_id'],['order_customer_links.source_record_id','orders.source_record_id','one-to-one','each paid/refund entry must have a link'],['order_customer_links.customer_id','customers.id','many-to-one','dedup identity for paid/retained cohorts'],['order_customer_links.event_intent_id','events.source_record_id','many-to-one','A3 inquiry must precede payment; same customer/product/channel'],['order_customer_links.paid_source_record_id','orders.source_record_id','many-to-one','refund links original paid line'],['skus.product_id','products.id','many-to-one','master relation'],['inventory.sku_id','skus.id','many-to-one','snapshot key = occurred_at+warehouse_id+sku_id'],['inventory.warehouse_id','warehouses.id','many-to-one','same isolated business'],['inventory_ledger.reference_id','orders.source_record_id or arrival_receipts.id','many-to-one','opening rows explicitly use sim-opening'],['arrival_receipts.plan_id','arrival_plan_versions.plan_id','many-to-one','sum receipts visible at cutoff; select plan version known by cutoff'],['arrival_plan_versions.sku_id','skus.id','many-to-one','same isolated business'],['expenses.channel','channels.id','many-to-one','source kept separate per kind'],['products.role_id','product_roles.id','many-to-one','entry/core/flagship canonical vocab; external_id is sim-role-*']]
 with (OUT/'primary-foreign-keys.csv').open('w',newline='') as f:
  w=csv.writer(f);w.writerow(['source','target','cardinality','validation_rule']);w.writerows(links)
 required_changes=[
  {'fieldGroup':'customer master + order customer linkage','files':['normal/master/customers.csv','normal/sidecars/order_customer_links.csv'],'existingFourTemplates':'events.contact_id supported; order customer not supported','currentOntology':'default event/order types do not include customer linkage','needed':'tenant-aware customers and order/customer association; same-cohort customer funnel'},
  {'fieldGroup':'historical stock and SKU role targets','files':['normal/imports/inventory-*.csv','normal/master/product_roles.csv','normal/master/skus.csv'],'existingFourTemplates':'dated observations, quantity/cost/safety supported','needed':'unique SKU denominator across warehouses; aggregate safety before role qualification; source snapshot observation time'},
  {'fieldGroup':'arrival plan revisions','files':['normal/sidecars/arrival_plan_versions.csv','normal/sidecars/arrival_receipts.csv'],'existingFourTemplates':'only in_transit_units; no ETA/version/known_at','currentOntology':'normal/ontology/arrival.csv imports only latest current planned ETA','needed':'business known_at separately from system committed_at; as-of version query; receipts at cutoff only'},
  {'fieldGroup':'stock ledger','files':['normal/sidecars/inventory_ledger.csv'],'existingFourTemplates':'unsupported; not emitted as event','needed':'optional independent reconciliation table, not repeated inventory totals'},
  {'fieldGroup':'market contexts','files':['normal/sidecars/fictional_market_events.csv'],'existingFourTemplates':'unsupported','currentOntology':'market_evidence is generated and cannot be imported','needed':'separate synthetic context status; never inject into verified market evidence'},
  {'fieldGroup':'master revision/cross-tenant FK','files':['counterexamples/cross-enterprise-sku.csv','counterexamples/product-sku-mismatch.csv'],'existingFourTemplates':'both scalar-valid samples accepted as ready in current baseline','needed':'server-side tenant-aware FK/product-SKU association checks; supported immutable master versions'},
 ]
 write(OUT/'field-mapping.json',{'businessId':m['businessId'],'templateVersion':'1','amountRule':'typed CNY cents; convert to yuan for UI only','facts':{k:dict(files=[b['file'] for b in m['importBatches'] if b['kind']==k],headers=list(source[k][0]),supported=True) for k in ['events','orders','inventory','expenses']},'requiredChanges':required_changes,'normalDataNature':'demo','noProductCodeChanged':True})
 lines=['# 字段与接入映射','','本工具校验四模板v1事实及v2主数据/到货资料导入。以下旧字段缺口和页面状态描述属于该路径的测试范围，不代表当前主仓尚未实现；完整资料/客户关联已有单独接入与验收。','','主数据、侧表与四模板分开。原始金额均为整数分；不要将本文件中的独立期望作为预测输入。','', '| 数据表 | 粒度 | 条数 |','|---|---|---|']
 for table,rows in source.items():lines.append(f'| {table} | {grains.get(table,"")} | {len(rows)} |')
 lines+=['','## 必须保留的口径','','- 财务按分录发生日在所选经营期记账，支付减退款；变量成本按退款实际回转额扣减，贡献毛利再减广告费。','- 支付订单按来源和 order_id 去重，不能用订单明细数充当订单数。','- 客户按 contact_id / customer_id 去重。A3 以期间内的咨询客户为分母；A4 为其中期间有支付、截至观察日仍有正净数量的客户。全退客户排除，部分退客户保留。','- 比较 current8 与 previous8 的客户指标使用同样的期末后4天观察窗；金额比较仍按期内实际发生退款记账。','- 库存以每仓库/SKU截至日的最近观测为准；previous8 截至7月30日的库存最近观测是7月26日，不能宣称7月30日实时库存。','- 一个SKU跨两个仓库只进入角色达标分母一次：两仓可售数量之和 >= 两仓安全线之和。角色目标80%为预先配置，不由结果反推。','- 可售天数 = 当前可售 / 最近4个完整周支付件数 × 28；零销售返回null，未验证真正需求或预测。','- ETA 只能来自截至当时已知的计划版本；实际到货单独保存，query_known_plans.py 会过滤未来知悉版本与未来收货。','- entry/core/flagship 是固定枚举；真实外部角色主键为 external_id=sim-role-*。','', '## 四模板不支持的字段','']
 for item in required_changes:lines += [f'- **{item["fieldGroup"]}**：{item["existingFourTemplates"]}。需接入：{item["needed"]}。']
 lines+=['','## 原 Demo 看板的核对点','','| 页面/板块 | 可复核输入与期望 | 当前接入状态 |','|---|---|---|','| 今日经营/财务 | expected-results.periods.current8.financial；CNY分→元 | 原 snapshot 路径实测匹配 |','| 我的客户 | raw events / paidOrders 和 customerFunnel 分列 | 事件/订单已匹配；客户去重侧表待新字段接入 |','| 商品/库存 | 每商品净销量、当前可售/在途/成本/ETA、最近4周可售天数 | 原 domain / snapshot / 展示适配已匹配 |','| 角色供给 | 2/4/2 SKU，分周 qualifiedSkuCount/ratio/80%目标 | 独立期望已提供；原 adapter 仍缺历史达标计算 |','| 渠道 | channels / productChannel / roleMatrix；费用与期内订单事件 | 两渠道、8商品渠道切片和展示适配实测；6格角色矩阵有独立期望 |','| 竞品/需求/政策 | 两条 fictional 市场情境；政策无记录 | 侧表明确虚构；不写真实市场证据 |','| 预测/情景 | 24周分周数据、point-in-time计划、cutoff8/12/16/20/24 | 本线不制造未来预测或效果，交预测工作线使用 |','| 方案记录/周报 | 固定企业、快照、范围，actual outcomes 未生成 | 本线只供资料与计算基线，不伪造行动结果 |','']
 (OUT/'字段字典与接入映射.md').write_text('\n'.join(lines)+'\n')
 # Baseline fingerprints must stay untouched. Generated caches are not transferred.
 m['files']={str(p.relative_to(OUT)):dict(sha256=digest(p),bytes=p.stat().st_size) for p in sorted(OUT.rglob('*')) if p.is_file() and p.name!='manifest.json' and not p.relative_to(OUT).parts[0].startswith('runtime') and '__pycache__' not in p.parts}
 m['generatorFiles']={str(p.relative_to(ROOT)):digest(p) for p in sorted((ROOT/'scripts/synthetic-data').glob('*')) if p.is_file()}
 m['acceptanceStatus']='tool_checks_only; full24 product acceptance is recorded separately'
 if (OUT/'reports/backend-validation.json').exists():m['backendValidation']=json.loads((OUT/'reports/backend-validation.json').read_text())['checksPassed']
 m['independentQualityChecks']=json.loads((OUT/'reports/quality-validation.json').read_text())['checkCount']
 write(OUT/'manifest.json',m)
 print(json.dumps({'status':'catalogued','fieldDefinitions':len(fields),'backendChecks':m.get('backendValidation'),'manifest':str(OUT/'manifest.json')},ensure_ascii=False))

if __name__=='__main__':main()
