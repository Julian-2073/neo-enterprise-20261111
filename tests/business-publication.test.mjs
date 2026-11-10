import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {validateBusinessLedger} from '../lib/business-ledger.ts';
import {drainBusinessUpdates} from '../server/business-generations.ts';

const payment={sourceId:'erp',kind:'order',recordKey:'paid',orderId:'o',entityId:'sku',channelId:'shop',entryType:'paid',businessDate:'2026-09-30',quantity:10,amountCents:10000,variableCostCents:1000};
const refund=(key,quantity=6)=>({...payment,recordKey:key,entryType:'refund',quantity,amountCents:quantity*1000,variableCostCents:quantity*100});
const profile={industry:'ecommerce',name:'发布边界验收',timezone:'Asia/Shanghai',region:'CN',horizonDays:3,objective:'contribution_margin',cashBudgetCents:100000,competitors:[],expectedSources:[{sourceId:'erp',kinds:['order','expense']}]};
const clean=r=>Object.fromEntries(Object.entries(r).filter(([key])=>key!=='sourceId'));
async function fixture(fn){
 const {mf,runtime}=await localRuntime();
 const call=async(path,body)=>{const r=await handleApi(new Request('http://localhost/api/v1/'+path+(path.includes('?')?'&':'?')+'businessId=test-a&dataNature=demo',{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},body:body?JSON.stringify(body):undefined}),runtime);return {status:r.status,data:await r.json()};};
 const ingest=(requestId,records,extra={})=>call('business-inputs',{dataNature:'demo',sourceId:'erp',requestId,records:records.map(clean),expectedRowCount:records.length,coverageKinds:['order'],coverageStart:'2026-09-01',coverageEnd:'2026-09-30',...extra});
 try{assert.equal((await call('business-profile',{dataNature:'demo',baseVersion:null,profile})).status,201);await fn({runtime,call,ingest});}finally{await mf.dispose();}
}
test('ledger validates partial refunds, time, source, line identity, known cost and payment corrections',()=>{
 assert.doesNotThrow(()=>validateBusinessLedger([payment,refund('r1',4),refund('r2',6)]));
 assert.throws(()=>validateBusinessLedger([payment,refund('r1'),refund('r2')]),/累计退款/);
 assert.throws(()=>validateBusinessLedger([payment,{...refund('r'),businessDate:'2026-09-29'}]),/早于/);
 assert.throws(()=>validateBusinessLedger([payment,{...refund('r'),sourceId:'other'}]),/依据/);
 assert.throws(()=>validateBusinessLedger([payment,{...payment,recordKey:'duplicate'}]),/一条/);
 assert.throws(()=>validateBusinessLedger([{...payment,variableCostCents:null},refund('r')]),/余额/);
 const lines=[{...payment,orderLineId:'one'},{...payment,recordKey:'two',orderLineId:'two'}];
 assert.doesNotThrow(()=>validateBusinessLedger([...lines,{...refund('r'),orderLineId:'one'}]));
 assert.throws(()=>validateBusinessLedger([...lines,{...refund('r'),orderLineId:'one',entityId:'other'}]),/商品和渠道/);
});
test('parallel refunds cannot jointly exceed a paid balance; rejected batches publish no coverage or facts',async()=>fixture(async({runtime,ingest,call})=>{
 assert.equal((await ingest('payment',[payment])).status,201);
 const responses=await Promise.all([ingest('refund-a',[refund('ra')]),ingest('refund-b',[refund('rb')])]);
 assert.equal(responses.filter(r=>r.status===201).length,1,JSON.stringify(responses));
 assert.ok([409,422].includes(responses.find(r=>r.status!==201).status));
 const state=(await call('business-state?asOf=2026-09-30&start=2026-09-01&end=2026-09-30')).data.state;
 assert.equal(state.metrics.netRevenueCents.value,4000);assert.equal(state.inputs.filter(r=>r.entryType==='refund').length,1);
 assert.equal((await runtime.DB.prepare("SELECT COUNT(*) n FROM neo_business_imports WHERE request_id IN ('refund-a','refund-b')").first()).n,1);
 assert.equal((await runtime.DB.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='business_input_published'").first()).n,2);
 const paid=state.inputs.find(r=>r.entryType==='paid');
 assert.equal((await ingest('bad-correction',[{...payment,quantity:5,amountCents:5000,supersedesId:paid.id}])).status,422);
 assert.equal((await ingest('line-conflict',[{...payment,recordKey:'another-paid'}])).status,422);
}));
test('refund fragments can precede payment fragments; seal atomically validates ledger and only then publishes',async()=>fixture(async({runtime,ingest,call})=>{
 const group={groupId:'split-ledger',partCount:2};
 assert.equal((await ingest('ignored',[refund('r',4)],{...group,partIndex:0})).status,201);
 assert.equal((await ingest('formal',[refund('r',4)])).status,409);
 assert.equal((await ingest('ignored',[payment],{...group,partIndex:1})).status,201);
 const seal={dataNature:'demo',groupId:group.groupId,expectedRowCount:2,expectedTotals:{amountCents:6000,quantity:6}};
 assert.equal((await call('business-inputs/seal',seal)).status,201);
 assert.equal((await call('business-inputs/seal',seal)).data.reused,true);
 assert.equal((await ingest('formal',[refund('r',4)])).data.duplicateCount,1);
 assert.equal((await call('business-state?asOf=2026-09-30&start=2026-09-01&end=2026-09-30')).data.state.metrics.netRevenueCents.value,6000);
 assert.equal((await ingest('ignored',[{...refund('orphan'),orderId:'missing-paid'}],{groupId:'orphan-group',partIndex:0,partCount:1})).status,201);
 const bad={dataNature:'demo',groupId:'orphan-group',expectedRowCount:1,expectedTotals:{amountCents:-6000,quantity:-6}};
 assert.equal((await call('business-inputs/seal',bad)).status,422);
 assert.equal(await runtime.DB.prepare("SELECT id FROM neo_business_imports WHERE request_id='seal:orphan-group'").first(),null);
}));
test('expired computation lease cannot publish generation, head or follow-up review',async()=>fixture(async({runtime})=>{
 const id='expiring-event',now=new Date().toISOString();
 await runtime.DB.prepare("INSERT INTO neo_business_updates(id,business_id,data_nature,cause,resource_id,status,created_at) VALUES(?,'test-a','demo','import','test','pending',?)").bind(id,now).run();
 const before=await runtime.DB.prepare('SELECT generation_id FROM neo_business_heads').first();
 let computing=false;
 const db={prepare(sql){if(sql.startsWith('INSERT OR IGNORE INTO neo_business_generations'))computing=true;return runtime.DB.prepare(sql);},async batch(commands){if(computing){computing=false;await runtime.DB.prepare("UPDATE neo_business_updates SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?").bind(id).run();}return runtime.DB.batch(commands);}};
 const results=await drainBusinessUpdates({db,runtime:{...runtime,DB:db},userId:'local-owner',businessId:'test-a',businessName:'test',role:'admin'},'demo');
 assert.equal(results.find(r=>r.updateId===id).status,'lease_lost');
 assert.deepEqual(await runtime.DB.prepare('SELECT generation_id FROM neo_business_heads').first(),before);
 assert.equal((await runtime.DB.prepare('SELECT status FROM neo_business_updates WHERE id=?').bind(id).first()).status,'running');
}));

test('migration initializes heads by frozen cutoff for inline and R2 generations, preserving historical payloads',async()=>{
 const {mf,runtime}=await localRuntime();
 try{
 const values=[['older-recomputed',{storageFormat:'neo-generation-r2-v1',summary:{state:{knownAt:'2026-10-01T00:00:00.000Z'}}},'2026-10-07T00:00:00.000Z'],['newer',{state:{knownAt:'2026-10-02T00:00:00.000Z'}},'2026-10-02T00:00:00.000Z']];
 for(const [id,payload,at] of values)await runtime.DB.prepare("INSERT INTO neo_business_generations VALUES(?,'test-a','demo',?,'calculated',?,?,?)").bind(id,id,JSON.stringify(payload),at,at).run();
 await runtime.DB.batch(['DROP TABLE neo_business_heads','DROP TABLE neo_business_publications'].map(sql=>runtime.DB.prepare(sql)));
 const migration=(await readFile('docs/migration-compatibility/original/0016_light_mac_gargan.sql','utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
 await runtime.DB.batch(migration.map(sql=>runtime.DB.prepare(sql)));
 assert.equal((await runtime.DB.prepare('SELECT generation_id FROM neo_business_heads').first()).generation_id,'newer');
 assert.equal((await runtime.DB.prepare('SELECT COUNT(*) n FROM neo_business_generations').first()).n,2);
 }finally{await mf.dispose();}
});
