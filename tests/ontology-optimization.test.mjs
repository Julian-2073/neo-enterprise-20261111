import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {scalarValue} from '../server/ontology/model.ts';
let mf,runtime,definitionId,buildId;
before(async()=>({mf,runtime}=await localRuntime()));after(async()=>mf?.dispose());
async function request(path,body,method=body?'POST':'GET'){
 const r=await handleApi(new Request('http://localhost/api/v1/ontology/'+path+(path.includes('?')?'&':'?')+'businessId=test-a&dataNature=demo',{method,headers:{origin:'http://localhost',...(body instanceof FormData?{}:{'content-type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),runtime);return {status:r.status,data:await r.json()};
}
async function ok(path,body){const r=await request(path,body);assert.ok(r.status<400,JSON.stringify(r));return r.data;}
const action=(body,id=crypto.randomUUID())=>ok('actions/submit',{dataNature:'demo',requestId:id,...body});
const type=(id,properties)=>({id,name:id,primaryKey:'id',title:'id',properties:{id:{type:'string',required:true},...properties}});
test('complete action preview detects relational conflict without effects; submit fails without poisoned edits',async()=>{
 const definition={version:'probe',types:[type('asset',{slotId:{type:'string',mode:'editable'}}),type('slot',{})],links:[{id:'assignment',name:'assignment',from:'asset',to:'slot',property:'slotId',cardinality:'one-to-one'}]};
 const d=await ok('definitions',{baseId:(await ok('definitions')).definition.version,definition});definitionId=d.id;await action({action:'publish_definition',draftId:d.id});
 for(const [typeId,csv]of [['asset','id,slotId\na,\nb,s'],['slot','id\ns']]){const f=new FormData();f.set('file',new File([csv],'probe.csv'));f.set('typeId',typeId);f.set('sourceName','test');f.set('definitionId',d.id);f.set('dataNature','demo');const b=await ok('imports',f);await action({action:'commit_import',batchId:b.batch.id});}
 const b=await action({action:'build_projection',definitionId,asOf:'2026-10-04'});buildId=b.result.id;
 const input={action:'edit_property',dataNature:'demo',buildId,typeId:'asset',objectId:'a',property:'slotId',value:'s'};
 const before=await runtime.DB.prepare('SELECT COUNT(*) n FROM ontology_edits').first();const p=await ok('actions/preview',input);assert.equal(p.valid,false);assert.ok(p.issues.some(i=>i.code==='LINK_CARDINALITY'));
 assert.equal((await runtime.DB.prepare('SELECT COUNT(*) n FROM ontology_edits').first()).n,before.n);
 assert.equal((await request('actions/submit',{...input,requestId:'invalid-edit'})).status,422);
 const runs=await ok('runs');assert.equal(runs.items.find(r=>r.input.requestId==='invalid-edit').status,'failed');
 const fresh=await action({action:'build_projection',definitionId,asOf:'2026-10-04'});assert.notEqual(fresh.result.status,'failed');buildId=fresh.result.id;
 assert.equal((await runtime.DB.prepare("SELECT COUNT(*) n FROM ontology_edits WHERE status='committed'").first()).n,0);
});
test('one edit wins per projection and identical request replay has no extra effects',async()=>{
 const input={action:'edit_property',buildId,typeId:'asset',objectId:'b',property:'slotId',value:null};
 const results=await Promise.all([request('actions/submit',{...input,dataNature:'demo',requestId:'edit-a'}),request('actions/submit',{...input,dataNature:'demo',requestId:'edit-b'})]);
 assert.equal(results.filter(r=>r.status<400).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
 const winner=results.find(r=>r.status<400).data;assert.equal(winner.status,'completed');assert.equal(winner.result.status,'ready');
 const replay=await action(input,winner.input.requestId);assert.equal(replay.id,winner.id);
 assert.equal((await runtime.DB.prepare("SELECT COUNT(*) n FROM ontology_edits WHERE status='committed'").first()).n,1);
});
test('numeric business constraints do not ban valid negative refund values',()=>{
 assert.throws(()=>scalarValue(-1,{type:'number',min:0}));assert.equal(scalarValue(-1,{type:'number'}),-1);assert.throws(()=>scalarValue('x',{type:'string',enum:['a','b']}));
});
test('SQL queries preserve sorting, linked details and pinned saved sets',async()=>{
 const latest=await runtime.DB.prepare("SELECT result_build_id id FROM ontology_edits WHERE status='committed'").first();const id=latest.id;
 const result=await ok('objects/query',{dataNature:'demo',buildId:id,query:{typeId:'asset',sort:{property:'id',direction:'desc'},limit:1}});assert.equal(result.items[0].id,'b');assert.equal(result.nextCursor,1);
 const detail=await ok(`objects/asset/a?buildId=${id}`);assert.equal(detail.type.id,'asset');assert.ok(detail.related);assert.ok(detail.history);
 const set=await ok('object-sets',{dataNature:'demo',buildId,name:'旧集合',query:{typeId:'asset'}});const newer=await ok(`object-sets/${set.id}/latest`,{});assert.equal(newer.originalBuildId,buildId);assert.equal((await ok(`object-sets/${set.id}`)).build_id,buildId);
});
test('mapping preview reports field errors without creating definitions',async()=>{
 const count=(await runtime.DB.prepare('SELECT COUNT(*) n FROM ontology_definitions').first()).n;
 const d={version:'v',types:[type('custom',{units:{type:'integer',min:0}})],links:[]};const r=await ok('definitions/preview',{definition:d,typeId:'custom',rows:[{id:'a',units:-1}]});assert.equal(r.rows[0].issues[0].field,'units');assert.equal((await runtime.DB.prepare('SELECT COUNT(*) n FROM ontology_definitions').first()).n,count);
});
test('publication storage failure rejects staged edits and leaves the previous projection valid',async()=>{
 const latest=await runtime.DB.prepare("SELECT result_build_id id FROM ontology_edits WHERE status='committed'").first();const id=latest.id;
 const originalDB=runtime.DB;let failed=false;
 runtime.DB=new Proxy(originalDB,{get(target,key){if(key==='batch')return async statements=>{if(!failed&&statements.length===4){failed=true;throw new Error('publication unavailable');}return target.batch(statements);};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 try{const r=await request('actions/submit',{dataNature:'demo',requestId:'failed-store',action:'edit_property',buildId:id,typeId:'asset',objectId:'a',property:'slotId',value:'s'});assert.equal(r.status,503);assert.equal(failed,true);
 assert.equal((await runtime.DB.prepare("SELECT COUNT(*) n FROM ontology_edits WHERE status='staged'").first()).n,0);
 assert.equal((await runtime.DB.prepare("SELECT status FROM ontology_runs WHERE request_id='failed-store'").first()).status,'failed');
 assert.equal((await ok('objects/query',{dataNature:'demo',buildId:id,query:{typeId:'asset',filters:[{property:'id',op:'eq',value:'a'}]}})).items[0].properties.slotId,null);
 }finally{runtime.DB=originalDB;}
 const fresh=await action({action:'build_projection',definitionId,asOf:'2026-10-04'});assert.notEqual(fresh.result.status,'failed');
});
