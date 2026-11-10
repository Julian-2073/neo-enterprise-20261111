import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readStoredResult,storedObservation} from '../server/agent-state.ts';

test('large full reference text is stored once and restored without losing Unicode, receipt, scope or runtime',()=>{
 const exact='完整订单与每周统计原文。'.repeat(6000);
 const original={finding:{conclusion:'先核实退款来源',evidenceIds:['actual']},specialists:{},marketEvidence:[],businessAssessment:{version:'business-assessment-v1',context:{completeReview:true,semanticValidation:{version:'semantic-support-v1',status:'verified',claimCount:30}},projections:{},claims:Array.from({length:30},(_,i)=>({id:'claim:'+i,statement:'保留事实'+i,supportingReferences:[{id:'actual',exact}],counterevidence:[{id:'opposing',exact}]}))}};
 const obs={gatewayRevision:'retained-control',modelCallsUncertain:0};
 const stored=storedObservation(original,obs),raw=JSON.stringify(stored);
 assert(Buffer.byteLength(JSON.stringify(original))>1_900_000&&Buffer.byteLength(raw)<1_900_000);
 assert.equal(stored.runtime.gatewayRevision,obs.gatewayRevision);
 const restored=readStoredResult(raw);assert.deepEqual(restored.result.businessAssessment,original.businessAssessment);assert.deepEqual(restored.observability,obs);
 assert.equal(original.businessAssessment.claims[29].supportingReferences[0].exact,exact);
 assert(!Object.hasOwn(restored.result,'__evidenceTexts'));
});

test('bad shared reference indices are rejected before exposing analysis',()=>{
 const stored={__evidenceStorageVersion:'text-table-v1',__evidenceTexts:['actual'],finding:{quote:{__evidenceTextRef:2}}};
 assert.throws(()=>readStoredResult(JSON.stringify(stored)),/索引无效/);
});

test('large unverified prose stays blocked after lossless expansion',()=>{
 const text='内部未通过文稿。'.repeat(1000);
 const raw=JSON.stringify(storedObservation({finding:{conclusion:'不应发布',exact:text,quote:text},specialists:{},marketEvidence:[],runtimePlan:{},semanticValidation:{version:'semantic-support-v1',status:'pending'}}));
 assert.equal(readStoredResult(raw).result.finding,null);
});


test('compressed claim metadata round trips and still leaves SQL publication flags and runtime visible',()=>{
 const original={finding:{conclusion:'保留原结论'},specialists:{},marketEvidence:[],businessAssessment:{version:'business-assessment-v1',scope:{configurationVersion:'current-config'},context:{completeReview:true,semanticValidation:{version:'semantic-support-v1',status:'verified'}},projections:{},claims:Array.from({length:3000},(_,i)=>({id:'claim:'+i,statement:'不同事实'+i,source:'记录'+i}))}};
 const stored=storedObservation(original,{gatewayRevision:'visible'});assert.equal(stored.businessAssessment.claims.__neoGzipJsonV1,true);
 assert.equal(stored.businessAssessment.context.completeReview,true);assert.equal(stored.runtime.gatewayRevision,'visible');
 assert.deepEqual(readStoredResult(JSON.stringify(stored)).result.businessAssessment,original.businessAssessment);
 stored.businessAssessment.claims.payload='invalid';assert.throws(()=>readStoredResult(JSON.stringify(stored)),/无法完整回读/);
});
