import assert from 'node:assert/strict';
import test from 'node:test';
import {api} from '../components/business/use-workspace.ts';

test('concurrent identical reads share transport but retain independent response objects',async()=>{
 const original=globalThis.fetch;const resolvers=[];let calls=0;
 globalThis.fetch=async()=>{calls++;return new Promise(r=>{resolvers.push(r);});};
 try{const a=api('/read-shared'),b=api('/read-shared');for(const resolve of resolvers)resolve(Response.json({nested:{value:40}}));const [x,y]=await Promise.all([a,b]);assert.equal(calls,1);x.nested.value=99;assert.equal(y.nested.value,40);}finally{globalThis.fetch=original;}
});
test('a transient read 503 is retried without repeating writes',async()=>{
 const original=globalThis.fetch;let reads=0,writes=0;
 globalThis.fetch=async(_path,options)=>{if(options.method==='POST'){writes++;return Response.json({error:{message:'write receipt unknown'}},{status:503});}reads++;return reads===1?Response.json({error:{code:'STORAGE_UNAVAILABLE',message:'transient'}},{status:503}):Response.json({value:40});};
 try{assert.deepEqual(await api('/read-retry'),{value:40});await assert.rejects(api('/write-once',{method:'POST',body:'{}'}),/write receipt unknown/);assert.equal(writes,1);assert.equal(reads,2);}finally{globalThis.fetch=original;}
});
test('persistent read errors terminate with the server message',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({error:{message:'快照不存在'}},{status:404});};
 try{await assert.rejects(api('/unknown-snapshot'),/快照不存在/);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
