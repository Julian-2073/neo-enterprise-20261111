import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {POLICY_SOURCES,readRegisteredPolicy,policyPublishedAt,fitnessPolicyRelevant} from '../server/policy-briefing.ts';
let mf,runtime;const originalFetch=globalThis.fetch,calls=[];
const date=new Date('2026-10-06T08:00:00Z');
const html=(s,day='2025-09-04')=>`<html><head><meta name="PubDate" content="${day} 00:00"></head><body>${s.title} ${s.documentNumber} ${s.clauses.join(' ')} ${'已公开的政策原文条款。'.repeat(100)}</body></html>`;
const scope={snapshotId:'policy-snapshot',dataNature:'demo'},q='businessId=test-a&snapshotId=policy-snapshot&dataNature=demo';
const snapshot={id:scope.snapshotId,businessId:'test-a',dataNature:'demo',asOf:'2026-09-24',data:{materials:{domain:{products:[{id:'sku-x',name:'智能跑步机'}]}}}};
before(async()=>{
 ({mf,runtime}=await localRuntime());
 await runtime.DB.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(snapshot.id,'test-a','demo','2026-10-06',JSON.stringify(snapshot)).run();
 globalThis.fetch=async(url,options)=>{const s=POLICY_SOURCES.find(s=>s.url===url);if(!s)return originalFetch(url,options);calls.push(url);assert.equal(options.redirect,'error');return new Response(html(s),{headers:{'Content-Type':'text/html;charset=utf-8'}});};
});
after(async()=>{globalThis.fetch=originalFetch;await mf?.dispose();});
async function req(path='policy-briefing?'+q,method='GET',body,rt=runtime){const r=await handleApi(new Request('http://localhost/api/v1/'+path,{method,headers:{origin:'http://localhost','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),rt);return {status:r.status,data:await r.json()};}
test('policy extraction validates original clauses, publication date and annual expiry',async()=>{
 const s=POLICY_SOURCES[0],good=async()=>new Response(html(s),{headers:{'Content-Type':'text/html'}});
 const value=await readRegisteredPolicy(s,date,good);assert.equal(value.source.publishedAt,'2025-09-04');assert.equal(value.source.verificationStatus,'source_read');assert.ok(value.originalText.length>500);assert.equal(value.source.contentHash.length,64);
 const bad=async()=>new Response('<h1>页面不存在</h1>',{headers:{'Content-Type':'text/html'}});
 await assert.rejects(readRegisteredPolicy(s,date,bad),/内容或条款已变/);
 await assert.rejects(readRegisteredPolicy(s,date,async()=>new Response(html(s,'2027-01-01'),{headers:{'Content-Type':'text/html'}})),/发布日期/);
 await assert.rejects(readRegisteredPolicy(POLICY_SOURCES[1],new Date('2027-01-01'),async()=>new Response(html(POLICY_SOURCES[1]),{headers:{'Content-Type':'text/html'}})),/已到期/);
 assert.equal(policyPublishedAt('<meta name="PubDate" content="2025-02-30">'),null);
 assert.equal(policyPublishedAt('<p>2025年9月4日</p>'),null);
 assert.equal(fitnessPolicyRelevant({...snapshot,data:{materials:{domain:{products:[{name:'咖啡'}]}}}}),false);
 assert.equal(fitnessPolicyRelevant({...snapshot,businessName:'健身企业',data:{}}),false);
});
test('GET is pure; new POST queues scoped sources and never publishes static guidance as a fresh assessment',async()=>{
 assert.equal((await req()).data.briefing,null);assert.equal(calls.length,0);
 const created=await req(undefined,'POST',scope);assert.equal(created.status,202,JSON.stringify(created));assert.equal(created.data.briefing,null);assert.equal(created.data.tasks.length,3);assert.equal(calls.length,0);
 const repeated=await req(undefined,'POST',scope);assert.deepEqual(repeated.data.tasks.map(t=>t.id),created.data.tasks.map(t=>t.id));
 const saved=await runtime.DB.prepare("SELECT count(*) count FROM neo_artifacts WHERE kind='policy-briefing'").first();assert.equal(saved.count,0);
 assert.equal((await req('policy-briefing?businessId=test-b&snapshotId=policy-snapshot&dataNature=demo')).status,404);
 const reader={...runtime,local:{...runtime.local,userId:'local-reader'}};assert.equal((await req(undefined,'POST',scope,reader)).status,403);
 assert.equal((await req(undefined,'POST',scope,{...runtime,agentExecutionMode:'disabled'})).status,403);
});
test('historical static policy remains readable with explicit age and method',async()=>{
 const saved={id:'legacy-policy',businessId:'test-a',dataNature:'demo',snapshotId:scope.snapshotId,version:'official-policy-v1',checkedAt:'2026-09-01',day:'2026-09-01',items:[],gaps:[],coverage:'historical'};
 await runtime.DB.prepare('INSERT INTO neo_artifacts VALUES(?,?,?,?,?,?,?,?,?,?)').bind(saved.id,'test-a','demo',scope.snapshotId,'policy-briefing','legacy','legacy',null,JSON.stringify(saved),'2026-09-01').run();
 const read=await req();assert.equal(read.data.briefing.verificationMethod,'legacy_registered_guidance');assert.equal(read.data.briefing.stale,true);assert.equal(calls.length,0);
});
