import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
test('authorized automatic reviews persist a follow-up event, dispatch idempotently and stay disabled for manual delivery',async()=>{
 const {mf,runtime}=await localRuntime();let submissions=0;
 const server=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;res.setHeader('content-type','application/json');if(req.url==='/health')return res.end(JSON.stringify({modelConfigured:true,model:'isolated-model'}));if(req.method==='POST'&&req.url==='/runs')submissions++;res.end(JSON.stringify({id:body?.id,status:'queued',businessId:body?.businessId,snapshotId:body?.snapshotId,dataNature:body?.dataNature,steps:[],result:null}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const rt={...runtime,disableAutomaticPatrol:false,agentExecutionMode:'live',NEO_AGENT_URL:'http://127.0.0.1:'+server.address().port,NEO_SERVICE_TOKEN:'isolated-token-'.repeat(4)};
 const call=async(path,body,selected=rt)=>{const r=await handleApi(new Request('http://localhost/api/v1/'+path+'?businessId=test-a',{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},body:body?JSON.stringify(body):undefined}),selected);const value=await r.json();assert.ok(r.status<300,JSON.stringify(value));return value;};
 try{
 await call('business-profile',{dataNature:'demo',baseVersion:null,profile:{industry:'ecommerce',name:'自动刷新隔离测试',region:'CN',timezone:'Asia/Shanghai',horizonDays:3,objective:'contribution_margin',cashBudgetCents:10000,competitors:[],expectedSources:[{sourceId:'erp',kinds:['order','expense']}]}});
 const updates=await call('business-updates');assert.ok(updates.updates.some(r=>r.cause==='review'&&r.status==='pending'));assert.equal(submissions,0);
 await call('business-updates',{dataNature:'demo'});assert.equal(submissions,1);
 await call('business-updates',{dataNature:'demo'});assert.equal(submissions,1);
 const current=(await call('business-profile')).profile;
 await call('business-profile',{dataNature:'demo',baseVersion:current.version,profile:{...current.settings,name:'手动刷新模式'}},runtime);
 const manual=await call('business-updates',undefined,runtime);assert.equal(manual.updates.filter(r=>r.cause==='review').length,1);assert.equal(submissions,1);
 }finally{await new Promise(r=>server.close(r));await mf.dispose();}
});
