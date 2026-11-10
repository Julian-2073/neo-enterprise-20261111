import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {context} from '../server/auth.ts';
import {handleApi} from '../server/api.ts';
import {createBuild,getBuild,readBuildInput,buildData,envelopeForBuild} from '../server/ontology/store.ts';
import {prepareEdit} from '../server/ontology/edits.ts';
import {resources} from '../server/ontology/api.ts';
import {querySql} from '../server/ontology/query.ts';
import {hash} from '../server/csv.ts';

const definition={version:'storage-test-v1',types:[{id:'asset',name:'资产',primaryKey:'id',title:'id',properties:{id:{type:'string',required:true},note:{type:'string',mode:'editable'}}}],links:[]};
function captured(note='完整追溯'.repeat(450)){
 const data={snapshot:{id:'storage-snapshot',asOf:'2026-10-04',evidenceIds:{}},facts:[],domain:[],imports:[{id:'storage-import',typeId:'asset',rows:Array.from({length:400},(_,i)=>({id:`asset-${i}`,note})),availableAt:'2026-10-04T00:00:00Z'}],artifacts:[],edits:[]};
 return {data,asOf:'2026-10-04',knownAt:'2026-10-04T00:00:00Z',nature:'demo',definition,snapshotId:'storage-snapshot'};
}
test('large frozen input is lossless across storage, metadata, resources, query, envelope and edit transaction',async()=>{
 const {mf,runtime}=await localRuntime();
 try{
 const ctx=await context(new Request('http://localhost?businessId=test-a'),runtime),c=captured();
 assert.ok(Buffer.byteLength(JSON.stringify({...c.data,definition}))>1900000);
 await runtime.DB.prepare('INSERT INTO operating_snapshots(id,business_id,data_nature,generated_at,payload) VALUES(?,?,?,?,?)').bind('storage-snapshot','test-a','demo',c.knownAt,JSON.stringify(c.data.snapshot)).run();
 const result=await createBuild(ctx,{},c);assert.equal(result.status,'ready');
 const row=await getBuild(ctx,result.id),raw=JSON.parse(row.input);
 assert.equal(raw.storageFormat,'neo-inputs-gzip-v1');assert.ok(Buffer.byteLength(row.input)<1900000);
 assert.deepEqual(await readBuildInput(row),{...c.data,definition});
 assert.equal(row.source_hash,await hash(JSON.stringify([ctx.businessId,c.nature,definition,c.asOf,c.knownAt,c.data])));
 assert.equal((await buildData(ctx,result.id)).objects.length,400);
 assert.equal((await querySql(ctx,{dataNature:'demo',buildId:result.id,query:{typeId:'asset',limit:1}})).total,400);
 assert.ok((await resources(ctx,'demo',result.id)).items.some(r=>r.id==='type:asset'));
 const env=await envelopeForBuild(ctx,result.id);assert.equal(env.snapshot.id,'storage-snapshot');assert.ok(env.ontologyPacked);
 const edit={dataNature:'demo',buildId:result.id,typeId:'asset',objectId:'asset-0',property:'note',value:'编辑后'};
 const before=(await runtime.DB.prepare('SELECT count(*) n FROM ontology_edits').first()).n;
 assert.equal((await prepareEdit(ctx,edit)).preview.valid,true);assert.equal((await runtime.DB.prepare('SELECT count(*) n FROM ontology_edits').first()).n,before);
 // commitEdit requires the actual action run to atomically publish and persist the result.
 const request=new Request('http://localhost/api/v1/ontology/actions/submit?businessId=test-a',{method:'POST',headers:{origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({...edit,action:'edit_property',requestId:'storage-edit'})});
 const response=await handleApi(request,runtime),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.status,'completed');
 const next=await readBuildInput(await getBuild(ctx,body.result.id));assert.equal(next.imports[0].rows.length,400);assert.equal(next.edits[0].value,'编辑后');
 assert.deepEqual(await readBuildInput(row),{...c.data,definition});
 // All old bytes remain fixed; the published edit lives on a new frozen input.
 assert.equal((await runtime.DB.prepare('SELECT status FROM ontology_edits').first()).status,'committed');
 }finally{await mf.dispose();}
});
test('legacy plain JSON retains byte-identical input and round trips without a new codec marker',async()=>{
 const {mf,runtime}=await localRuntime();try{
 const ctx=await context(new Request('http://localhost?businessId=test-a'),runtime),c=captured('短备注');
 await runtime.DB.prepare('INSERT INTO operating_snapshots(id,business_id,data_nature,generated_at,payload) VALUES(?,?,?,?,?)').bind('storage-snapshot','test-a','demo',c.knownAt,JSON.stringify(c.data.snapshot)).run();
 const result=await createBuild(ctx,{},c),row=await getBuild(ctx,result.id);
 assert.equal(row.input,JSON.stringify({...c.data,definition}));assert.deepEqual(await readBuildInput(row),{...c.data,definition});
 assert.equal((await querySql(ctx,{dataNature:'demo',buildId:result.id,query:{typeId:'asset',limit:1}})).total,400);
 }finally{await mf.dispose();}
});
test('over-limit input returns controlled 413 and never creates a candidate or publishes a head',async()=>{
 const {mf,runtime}=await localRuntime();try{
 const ctx=await context(new Request('http://localhost?businessId=test-a'),runtime),c=captured('x'.repeat(70000));
 await assert.rejects(()=>createBuild(ctx,{},c),e=>e.status===413&&e.code==='INPUT_LIMIT');
 assert.equal((await runtime.DB.prepare('SELECT count(*) n FROM ontology_builds').first()).n,0);
 assert.equal((await runtime.DB.prepare('SELECT count(*) n FROM ontology_heads').first()).n,0);
 }finally{await mf.dispose();}
});
test('incompressible input exceeds the stored-field budget with a controlled error and no publication',async()=>{
 const {mf,runtime}=await localRuntime();try{
 const ctx=await context(new Request('http://localhost?businessId=test-a'),runtime),c=captured('短备注');
 const {randomBytes}=await import('node:crypto');c.data.snapshot.storageProbe=randomBytes(2*1024*1024).toString('base64');
 await assert.rejects(()=>createBuild(ctx,{},c),e=>e.status===413&&e.code==='INPUT_LIMIT');
 assert.equal((await runtime.DB.prepare('SELECT count(*) n FROM ontology_builds').first()).n,0);
 assert.equal((await runtime.DB.prepare('SELECT count(*) n FROM ontology_heads').first()).n,0);
 }finally{await mf.dispose();}
});
test('the actual dispatch envelope is bounded and lossless while local scope annotations use complete facts',async()=>{
 const {transportEnvelope}=await import('../server/ontology/transport.ts');
 const {decodeInput}=await import('../server/input-storage.ts');
 const env={ontologyRef:{buildId:'full',sourceHash:'unchanged'},snapshot:{id:'fixed'},facts:Array.from({length:900},(_,i)=>({id:String(i),sourceId:'source',batchId:'batch',row:i+1,fact:{quantity:0,amount_cents:-100,memo:'追溯'.repeat(450)}})),domain:{},ontologyPacked:{codec:'gzip-base64',payload:'inner-untouched'}};
 const raw=JSON.stringify(env);assert.ok(Buffer.byteLength(raw)>1900000);
 const compact=await transportEnvelope(env);assert.ok(Buffer.byteLength(JSON.stringify(compact))<1900000);
 assert.deepEqual(await decodeInput(JSON.stringify({storageFormat:'neo-inputs-gzip-v1',...compact.envelopePacked})),env);
 assert.equal(JSON.stringify(env),raw);assert.deepEqual(await transportEnvelope({snapshot:{id:'small'},facts:[]}),{snapshot:{id:'small'},facts:[]});
});
test('oversized captured input is HTTP 413 with failed run and the old effective head intact',async()=>{
 const {mf,runtime}=await localRuntime();try{
 const url='http://localhost/api/v1/ontology/actions/submit?businessId=test-a';
 const call=async requestId=>{const r=await handleApi(new Request(url,{method:'POST',headers:{origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({action:'build_projection',dataNature:'demo',definitionId:'neo-default-v1',asOf:'2026-10-04',requestId})}),runtime);return {status:r.status,data:await r.json()};};
 const base=await call('limit-baseline');assert.equal(base.status,200);
 for(let i=0;i<18;i++)await runtime.DB.prepare('INSERT INTO neo_domain_records(id,business_id,data_nature,kind,payload,created_at) VALUES(?,?,?,?,?,?)').bind(`limit-${i}`,'test-a','demo','unknown_test_kind',JSON.stringify({id:`limit-${i}`,data:'x'.repeat(1000000)}),'2026-01-01T00:00:00Z').run();
 const result=await call('limit-captured');assert.equal(result.status,413);assert.equal(result.data.error.code,'INPUT_LIMIT');
 assert.equal((await runtime.DB.prepare("SELECT status FROM ontology_runs WHERE request_id='limit-captured'").first()).status,'failed');
 assert.equal((await runtime.DB.prepare('SELECT build_id FROM ontology_heads').first()).build_id,base.data.result.id);
 assert.equal((await runtime.DB.prepare('SELECT count(*) n FROM ontology_builds').first()).n,1);
 assert.equal((await runtime.DB.prepare('SELECT status FROM ontology_builds WHERE id=?').bind(base.data.result.id).first()).status,'ready');
 }finally{await mf.dispose();}
});
