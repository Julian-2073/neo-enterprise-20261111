import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeResult,scopeMarketReferences} from '../server/agent-state.ts';
import {agentBody} from '../server/agents.ts';

test('market references repair old stored reviews, survive partial merges and do not double-prefix',()=>{
 const source={id:'run-a:source-one',verificationStatus:'source_read'};
 const previous={specialists:{},marketEvidence:[source],operatingReviews:{market:{evidenceIds:['source-one'],selectedSourceIds:['source-one']}}};
 const merged=mergeResult(previous,{specialists:{},marketEvidence:[{id:'source-one',verificationStatus:'source_read'}],partial:true,operatingReviews:{joint:{evidenceIds:['source-one']}}});
 const scoped=scopeMarketReferences(merged,'run-a');
 assert.equal(scoped.marketEvidence.length,1);assert.deepEqual(scoped.operatingReviews.market.selectedSourceIds,['run-a:source-one']);assert.deepEqual(scoped.operatingReviews.joint.evidenceIds,['run-a:source-one']);
 assert.deepEqual(scopeMarketReferences(scoped,'run-a'),scoped);assert.deepEqual(previous.operatingReviews.market.selectedSourceIds,['source-one']);
});
test('agent input limits UTF-8 bytes and cancels chunked streams before collecting the whole request',async()=>{
 await assert.rejects(()=>agentBody(new Request('http://localhost',{method:'POST',body:JSON.stringify({text:'汉'.repeat(22000)})})),e=>e.status===413);
 let pulls=0,cancelled=false;
 const stream=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(32769));},cancel(){cancelled=true;}},{highWaterMark:0});
 await assert.rejects(()=>agentBody(new Request('http://localhost',{method:'POST',body:stream,duplex:'half'})),e=>e.status===413);
 assert.equal(pulls,2);assert.equal(cancelled,true);
 assert.deepEqual(await agentBody(new Request('http://localhost',{method:'POST',body:'{"text":"可用"}'})),{text:'可用'});
});
