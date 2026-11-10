import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {neoDefinitionV2,mapRecord,recordIssues,validateDefinition} from '../server/ontology/model.ts';
import {mappingPreview} from '../server/ontology/definitions.ts';
import {project} from '../server/ontology/project.ts';
import {propertyRule,constraintText,modelPackage,modelIri,vocabularyGraph,filterIssues} from '../lib/ontology-design.ts';
const d=neoDefinitionV2(),inventory=d.types.find(t=>t.id==='inventory');
test('display, preview and record validation share the enforced safety-stock and primary-key rules',()=>{
 const row={id:'i1',skuId:'s1',warehouseId:'w1',safetyUnits:-1};
 assert.match(constraintText(inventory,'safetyUnits',inventory.properties.safetyUnits),/最小 0/);
 assert.equal(propertyRule(inventory,'id',{type:'string'}).required,true);
 assert.throws(()=>mapRecord(row,inventory),/数值超出允许范围/);
 const preview=mappingPreview({definition:d,typeId:'inventory',rows:[row]});
 assert.equal(preview.rows[0].value,null);assert.equal(preview.rows[0].issues[0].field,'safetyUnits');assert.equal(preview.rows[0].issues[0].constraintCode,'PROPERTY_RANGE');
 assert.equal(recordIssues(row,inventory)[0].field,'safetyUnits');
 const refund=d.types.find(t=>t.id==='refund');assert.equal(mapRecord({id:'r',orderLineId:'l',amountCents:-100},refund).amountCents,-100);
});
test('mapping scale zero has identical preview and committed conversion; computed input is pinpointed',()=>{
 const custom={id:'custom',name:'测量',primaryKey:'id',title:'id',properties:{id:{type:'string',required:true},units:{type:'number',min:0}},mapping:{units:{field:'raw',scale:0}}};
 const input={definition:{version:'v',types:[custom],links:[]},typeId:'custom',rows:[{id:'c',raw:-123}]};
 const preview=mappingPreview(input);assert.equal(preview.rows[0].issues.length,0);assert.ok(preview.rows[0].value.units===0);assert.equal(mapRecord(input.rows[0],custom,true).units,preview.rows[0].value.units);
 const t={...custom,properties:{...custom.properties,units:{type:'number',mode:'computed'}}};assert.equal(recordIssues({id:'c',raw:1},t,true)[0].constraintCode,'COMPUTED_PROPERTY');
});
test('projection validation preserves source location and never projects invalid source records',()=>{
 const custom={id:'asset',name:'设备',primaryKey:'id',title:'id',properties:{id:{type:'string',required:true},units:{type:'integer',min:0}},mapping:{units:{field:'count'}}};
 const input={facts:[],domain:[],artifacts:[],edits:[],imports:[{id:'batch',typeId:'asset',availableAt:'2026-10-06T00:00:00Z',rows:[{id:'a',count:-1}]}]};
 const result=project(input,{version:'v',types:[custom],links:[]},'2026-10-06');assert.equal(result.objects.length,0);
 assert.equal(result.issues[0].objectId,'a');assert.equal(result.issues[0].field,'units');assert.equal(result.issues[0].sourceField,'count');assert.equal(result.issues[0].row,1);
});
test('portable configuration retains scope and rules; vocabulary IDs are stable and enterprise isolated',()=>{
 const before=JSON.stringify(d),scope={buildId:'b1',asOf:'2026-09-24',knownAt:'2026-10-04T00:00:00Z',dataNature:'demo',configurationState:'固定投影定义'};
 const pack=modelPackage(d,'enterprise/a',scope);assert.deepEqual(pack.scope,{businessId:'enterprise/a',definitionId:d.version,...scope});
 assert.equal(pack.constraints.find(t=>t.typeId==='inventory').properties.safetyUnits.min,0);assert.equal(JSON.stringify(d),before);
 const graph=vocabularyGraph(d,'enterprise/a');const sku=graph['@graph'].find(t=>t['@id']===modelIri('enterprise/a','type','sku'));assert.equal(sku['@type'],'rdfs:Class');
 const l=graph['@graph'].find(t=>t['@id']===modelIri('enterprise/a','link','sku_product'));assert.equal(l.domain,modelIri('enterprise/a','type','sku'));assert.equal(l.range,modelIri('enterprise/a','type','product'));assert.equal(l['neo:inference'],'none');
 assert.notEqual(modelIri('enterprise/a','type','sku'),modelIri('enterprise','type','sku'));assert.equal(vocabularyGraph({...d,version:'next'},'enterprise/a')['@graph'][0]['@id'],graph['@graph'][0]['@id']);
 assert.doesNotMatch(JSON.stringify(graph),/owl:TransitiveProperty|sh:ValidationReport/);
});
test('quality filters retain exact severity, field and object targeting without modifying records',()=>{
 const issues=[{severity:'warning',code:'REFERENCE_ONLY',message:'缺少主数据',typeId:'sku',objectId:'S1'},{severity:'error',code:'PROPERTY_INVALID',message:'负数',typeId:'inventory',field:'safetyUnits'}];
 assert.deepEqual(filterIssues(issues,{severity:'error',typeId:'inventory',search:'Safety'}),[issues[1]]);assert.equal(filterIssues(issues,{severity:'',typeId:'sku',search:'S1'}).length,1);assert.equal(issues.length,2);
});
test('relationship metadata must be valid before a draft can be rendered or published',()=>{
 assert.throws(()=>validateDefinition({...d,links:[{...d.links[0],name:''}]}),/业务名称/);
 assert.throws(()=>validateDefinition({...d,links:[{...d.links[0],outName:{unexpected:true}}]}),/关系说明/);
 assert.equal(validateDefinition(d).links.length,d.links.length);
});

let mf,runtime;before(async()=>({mf,runtime}=await localRuntime()));after(async()=>mf?.dispose());
async function api(path,body){const method=body?'POST':'GET',r=await handleApi(new Request('http://localhost/api/v1/ontology/'+path+(path.includes('?')?'&':'?')+'businessId=test-a&dataNature=demo',{method,headers:{origin:'http://localhost',...(body instanceof FormData?{}:{'content-type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),runtime);return {status:r.status,data:await r.json()};}
test('free-type upload persists per-field constraints and rejects invalid rows without committing facts',async()=>{
 const definition={version:'custom',types:[{id:'measure',name:'测量',primaryKey:'id',title:'id',properties:{id:{type:'string',required:true},units:{type:'integer',min:0},status:{type:'string',enum:['active']}},mapping:{units:{field:'count'}}}],links:[]};
 const draft=await api('definitions',{baseId:d.version,definition});assert.equal(draft.status,201);
 const published=await api('actions/submit',{dataNature:'demo',action:'publish_definition',draftId:draft.data.id,requestId:'publish-design'});assert.ok(published.status<400,JSON.stringify(published));
 const f=new FormData();f.set('file',new File(['id,count,status\nm1,-2,unknown'],'invalid.csv'));f.set('sourceName','design-test');f.set('typeId','measure');f.set('definitionId',draft.data.id);f.set('dataNature','demo');
 const upload=await api('imports',f);assert.equal(upload.status,201);assert.equal(upload.data.batch.status,'invalid');
 assert.deepEqual(upload.data.batch.issues.map(i=>[i.row,i.field,i.sourceField,i.constraintCode]),[[2,'units','count','PROPERTY_RANGE'],[2,'status','status','PROPERTY_ENUM']]);
 const read=await api('imports/'+upload.data.batch.id);assert.deepEqual(read.data.batch.issues,upload.data.batch.issues);
 const commit=await api('actions/submit',{dataNature:'demo',action:'commit_import',batchId:upload.data.batch.id,requestId:'reject-invalid'});assert.equal(commit.status,409);assert.equal(commit.data.error.code,'BATCH_NOT_READY');
 assert.equal((await runtime.DB.prepare('SELECT COUNT(*) n FROM ontology_imports WHERE committed_at IS NOT NULL').first()).n,0);
});
