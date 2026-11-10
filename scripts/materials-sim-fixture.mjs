// SYNTHETIC_DEMO only; fixtures are hand-counted inputs, never production examples.
import Papa from 'papaparse';
export const SIM_BUSINESS='neo-sim-acceptance-20261004';
export const fixtureCsv=(headers,rows)=>Papa.unparse([headers,...rows]);
const mat=(fields,rows)=>fixtureCsv(['source_record_id','effective_from',...fields],rows.map(([id,...r])=>[id,'2026-04-06',...r]));
export const materialFixtures={
 roles:mat(['role_id','name'],[['sim-role-src','sim-core','主力品'],['sim-role2-src','sim-entry','入门品']]),
 channels:mat(['channel_id','name'],[['sim-channel-src','sim-douyin','抖音'],['sim-channel2-src','sim-tmall','天猫']]),
 warehouses:mat(['warehouse_id','name'],[['sim-warehouse-src','sim-east','华东仓'],['sim-warehouse2-src','sim-west','华西仓']]),
 customers:mat(['customer_id','name'],[['sim-c1-src','sim-c1','客户1'],['sim-c2-src','sim-c2','客户2'],['sim-c3-src','sim-c3','客户3']]),
 products:mat(['product_id','name','role_id','image_url'],[['sim-p1-src','sim-r1','模拟跑步机','sim-core','https://example.com/sim-r1.png'],['sim-p2-src','sim-m1','模拟入门品','sim-entry','']]),
 customer_identities:mat(['identity_namespace','external_id','customer_id'],[['sim-alias1-src','sim-platform','sim-external1','sim-c1'],['sim-alias2-src','sim-platform','sim-external2','sim-c2'],['sim-alias3-src','sim-platform','sim-external3','sim-c3']]),
 skus:mat(['sku_id','product_id','name','safety_units','unit'],[['sim-sku1-src','sim-r1-red','sim-r1','红色',5,'件'],['sim-sku2-src','sim-r1-blue','sim-r1','蓝色',0,'件'],['sim-sku3-src','sim-m1-black','sim-m1','黑色','','件']]),
 supply_rules:mat(['rule_id','role_id','minimum_sellable_units','target_ratio_bps'],[['sim-rule1-src','sim-core-rule','sim-core',5,7500],['sim-rule2-src','sim-entry-rule','sim-entry',0,6000]]),
 arrivals:fixtureCsv(['source_record_id','effective_from','arrival_id','sku_id','warehouse_id','eta','units','status'],[['sim-plan-src','2026-09-01','sim-plan1','sim-r1-red','sim-east','2026-10-06',20,'planned']]),
 orders:fixtureCsv(['source_record_id','order_id','order_line_id','entry_type','occurred_at','channel','product_id','sku_id','quantity','amount_cents','variable_cost_cents','identity_namespace','external_contact_id'],[
 ['sim-pay1','sim-o1','sim-l1','paid','2026-09-02T10:00:00','sim-douyin','sim-r1','sim-r1-red',2,20000,10000,'sim-platform','sim-external1'],
 ['sim-pay2','sim-o1','sim-l2','paid','2026-09-02T10:00:00','sim-douyin','sim-r1','sim-r1-blue',1,10000,5000,'sim-platform','sim-external1'],
 ['sim-refund1','sim-o1','sim-l1','refund','2026-09-03T10:00:00','sim-douyin','sim-r1','sim-r1-red',1,10000,5000,'sim-platform','sim-external1']]),
 inventory:fixtureCsv(['source_record_id','occurred_at','warehouse_id','product_id','sku_id','sellable_units','inventory_cost_cents','in_transit_units','safety_units'],[
 ['sim-stock1','2026-09-06','sim-east','sim-r1','sim-r1-red',6,6000,0,5],['sim-stock2','2026-09-13','sim-east','sim-r1','sim-r1-red',0,0,20,5],['sim-stock3','2026-09-13','sim-west','sim-r1','sim-r1-red',5,5000,0,5],['sim-stock4','2026-09-13','sim-east','sim-r1','sim-r1-blue',2,2000,0,0],['sim-stock5','2026-09-06','sim-east','sim-r1','sim-r1-blue',5,5000,0,0],['sim-stock6','2026-09-13','sim-east','sim-m1','sim-m1-black',0,0,0,'']]),
 expenses:fixtureCsv(['source_record_id','occurred_at','channel','amount_cents','product_id'],[['sim-cost-src','2026-09-02','sim-douyin',2000,'sim-r1']]),
 events:fixtureCsv(['source_record_id','occurred_at','event_type','channel','quantity','product_id','identity_namespace','external_contact_id','linked_order_id','linked_order_line_id'],[
 ['sim-event1','2026-09-01T10:00:00','inquiry','sim-douyin',2,'sim-r1','sim-platform','sim-external1','sim-o1','sim-l1'],
 ['sim-event2','2026-09-01T10:00:00','inquiry','sim-douyin',1,'sim-r1','sim-platform','sim-external2','',''],
 ['sim-event3','2026-09-12T10:00:00','inquiry','sim-douyin',1,'sim-r1','sim-platform','sim-external3','','']]),
};
export async function seedSimIdentity(DB){
 await DB.batch([DB.prepare('INSERT OR IGNORE INTO businesses(id,name) VALUES(?,?)').bind(SIM_BUSINESS,'NEO 隔离模拟企业'),DB.prepare('INSERT OR IGNORE INTO business_members(id,business_id,user_id,role) VALUES(?,?,?,?)').bind('sim-admin',SIM_BUSINESS,'local-owner','admin'),DB.prepare('INSERT OR IGNORE INTO business_members(id,business_id,user_id,role) VALUES(?,?,?,?)').bind('sim-reader',SIM_BUSINESS,'local-reader','reader')]);
}
export const simSnapshotInput={dataNature:'demo',asOf:'2026-09-14',periodStart:'2026-09-01',periodEnd:'2026-09-13',customerFunnel:{cohortStage:'A3',conversionWindowDays:7,channelPolicy:'same_channel'}};
