import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {startBusinessUpdatePump} from '../server/business-update-pump.ts';
import {handleApi} from '../server/api.ts';

test('worker reconciles archived snapshot jobs without dispatch, and session history sees saved terminal states',async()=>{
 const {mf,runtime}=await localRuntime(),original=globalThis.fetch,calls=[];
 const rt={...runtime,agentExecutionMode:'live',NEO_AGENT_URL:'http://agent.invalid',NEO_SERVICE_TOKEN:'fixture-token'};
 const pump=startBusinessUpdatePump(rt,60000),remote=new Map();
 try{
  for(const [i,mode] of ['conversion','supply','market','joint'].entries()){
   const id='archived-'+mode,nature=i===3?'business':'demo',session='session-'+id;
   await runtime.DB.prepare('INSERT INTO neo_sessions(id,business_id,data_nature,actor_id,created_at) VALUES(?,?,?,?,?)').bind(session,'test-a',nature,'local-owner','2026-10-06').run();
   const payload={id,businessId:'test-a',dataNature:nature,snapshotId:'older-snapshot',sessionId:session,mode,purpose:'analysis',question:'历史调查',envelope:{}};
   await runtime.DB.prepare("INSERT INTO neo_runs(id,business_id,data_nature,snapshot_id,session_id,request_id,request_hash,payload,status,steps,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'[]',?,?)").bind(id,'test-a',nature,'older-snapshot',session,id,'fixture',JSON.stringify(payload),i===0?'running':i===3?'deferred':'queued','2026-10-06','2026-10-06').run();
   remote.set(id,{...payload,status:i===3?'failed':'completed',error:i===3?'known failure':null,steps:[],result:null});
  }
  // A legacy task that never reached the service must not start as a side
  // effect of repairing historical display state.
  await runtime.DB.prepare("INSERT INTO neo_runs(id,business_id,data_nature,snapshot_id,session_id,request_id,request_hash,payload,status,steps,result,created_at,updated_at) SELECT 'unsent',business_id,data_nature,snapshot_id,session_id,'unsent','fixture',payload,'pending_dispatch','[]',?,created_at,updated_at FROM neo_runs WHERE id='archived-conversion'").bind(JSON.stringify({__observationOnly:true,runtime:{gatewayDispatch:'not_sent'}})).run();
  globalThis.fetch=async(url,options)=>{
   calls.push({url:String(url),method:options?.method});
   assert.equal(options?.method,'GET','background reconciliation never dispatches legacy jobs');
   const reply=remote.get(String(url).split('/').at(-1));assert.ok(reply);return Response.json(reply);
  };
  await pump.tick();
  for(const [id,value] of remote){
   assert.equal((await runtime.DB.prepare('SELECT status FROM neo_runs WHERE id=?').bind(id).first()).status,value.status);
   const response=await handleApi(new Request('http://localhost/api/v1/agent-sessions/session-'+id+'?businessId=test-a&dataNature='+value.dataNature),rt);
   assert.equal(response.status,200);assert.equal((await response.json()).runs.find(r=>r.id===id).status,value.status);
  }
  assert.equal((await runtime.DB.prepare("SELECT status FROM neo_runs WHERE id='unsent'").first()).status,'pending_dispatch');
  assert.equal(calls.length,4);await pump.tick();assert.equal(calls.length,4,'settled jobs do not keep polling');
 }finally{globalThis.fetch=original;await pump.stop();await mf.dispose();}
});
