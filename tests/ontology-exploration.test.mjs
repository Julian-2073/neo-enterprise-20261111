import assert from 'node:assert/strict';
import test from 'node:test';
import {objectExplorerHref,sourceEvidence} from '../lib/ontology-exploration.ts';
const build={id:'build-1',definitionId:'def-1',asOf:'2026-09-24',knownAt:'2026-10-04T00:00:00Z',snapshotId:'snapshot-1'};
test('graph navigation pins type and all projection scope including escaped enterprise ids',()=>{
 const p=new URL(objectExplorerHref('企业 & a','demo','sku',build),'http://localhost').searchParams;
 assert.deepEqual(Object.fromEntries(p),{view:'objects',businessId:'企业 & a',dataNature:'demo',resourceId:'type:sku',buildId:build.id,definitionId:build.definitionId,asOf:build.asOf,knownAt:build.knownAt,snapshotId:build.snapshotId});
 assert.equal(new URL(objectExplorerHref('b','business','product',{...build,snapshotId:null}),'http://localhost').searchParams.has('snapshotId'),false);
});
const p=(kind,id,row,batchId)=>({kind,id,row,batchId,availableAt:'2026-10-01T00:00:00Z',availability:'system_recorded'});
const input={facts:[{id:'f',batchId:'b',row:2,fact:{sku_id:'s'}}],imports:[{id:'i',rows:[{id:'s',name:'frozen'}]}],domain:[{id:'d',payload:{name:'domain'}}],artifacts:[{id:'a',payload:{value:1}}],edits:[{id:'e',value:'edited'}],operating:{inputs:[{id:'o',value:2}]}};
test('source content is resolved only from the matching frozen provenance',()=>{
 const result=sourceEvidence([p('fact','f',2,'b'),p('ontology_import','i',1),p('domain','d'),p('artifact','a'),p('edit','e'),p('operating_input','o')],input);
 assert.deepEqual(result.items.map(x=>x.record),[input.facts[0].fact,input.imports[0].rows[0],input.domain[0].payload,input.artifacts[0].payload,input.edits[0],input.operating.inputs[0]]);
 assert.equal(input.imports[0].rows[0].name,'frozen');
});
test('missing evidence, bad row or mismatched batch stay missing instead of substituting',()=>{
 for(const provenance of [p('fact','f',2,'wrong'),p('fact','f',3,'b'),p('ontology_import','i',0),p('ontology_import','i',-1),p('ontology_import','i',0.5),p('domain','missing'),p('unknown','f')])assert.equal(sourceEvidence([provenance],input).items[0].record,null);
});
test('large provenance is bounded with its true total retained',()=>{const r=sourceEvidence(Array.from({length:25},()=>p('domain','d')),input);assert.equal(r.total,25);assert.equal(r.items.length,20);});
