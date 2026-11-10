import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {startBusinessUpdatePump} from '../server/business-update-pump.ts';

test('same-generation conversation retains frozen history and replay; worker owns result sync, GET never contacts model',async()=>{
 const {mf,runtime}=await localRuntime(),jobs=new Map();let polls=0,remoteStatus='completed';
 const review={headline:'核查',explanation:'上轮已核对经营条件，继续确认缺失记录。',claims:[],evidenceIds:[],confirmations:[],nextAction:{title:'核查',reason:'资料不足',condition:'补齐后再判断'},limitations:[]};
 const server=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;res.setHeader('content-type','application/json');if(req.url==='/health')return res.end(JSON.stringify({modelConfigured:true,model:'local-test'}));if(req.method==='POST')jobs.set(body.id,body);else polls++;const job=body??jobs.get(req.url.split('/').at(-1));res.end(JSON.stringify({id:job.id,status:remoteStatus,businessId:job.businessId,snapshotId:job.snapshotId,dataNature:job.dataNature,steps:[],result:remoteStatus==='completed'?{operatingReviews:{conversion:review,supply:review,market:review,joint:review},specialists:{},marketEvidence:[]}:null}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const rt={...runtime,agentExecutionMode:'live',NEO_AGENT_URL:'http://127.0.0.1:'+server.address().port,NEO_SERVICE_TOKEN:'test-token-'.repeat(5)},pump=startBusinessUpdatePump(rt,60000);
 const call=async(path,body,generationId)=>{const r=await handleApi(new Request('http://localhost/api/v1/'+path+'?'+new URLSearchParams({businessId:'test-a',dataNature:'demo',...(generationId?{snapshotId:generationId}:{})}),{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},body:body?JSON.stringify({dataNature:'demo',...(generationId?{snapshotId:generationId}:{}),...body}):undefined}),rt);return {status:r.status,data:await r.json()};};
 try{
  const profile={industry:'ecommerce',name:'会话验收',timezone:'Asia/Shanghai',region:'CN',horizonDays:3,objective:'contribution_margin',cashBudgetCents:10000,competitors:[],expectedSources:[{sourceId:'erp',kinds:['order']}]};
  await call('business-profile',{baseVersion:null,profile});const g=(await call('business-generations')).data.generations[0].id;
  const first=await call('agent-runs',{requestId:'q1',question:'当前缺少什么？',mode:'joint'},g);assert.equal(first.status,202);const sessionId=first.data.sessionId;
  const secondBody={requestId:'q2',question:'按刚才的判断下一步怎么核查？',mode:'joint',sessionId};
  const second=await call('agent-runs',secondBody,g);assert.equal(second.status,202);assert.equal(second.data.sessionId,sessionId);const secondJob=[...jobs.values()][1];assert.equal(secondJob.history.length,2);assert.equal(secondJob.history[0].content,'当前缺少什么？');assert.equal(JSON.parse(secondJob.history[1].content).notice,'历史回答不构成本轮证据；数值须重新查询');
  remoteStatus='queued';const third=await call('agent-runs',{requestId:'q3',question:'继续查看确认项',mode:'joint',sessionId},g);assert.equal(third.status,202);assert.equal(third.data.status,'queued');assert.equal([...jobs.values()][2].history.length,4);
  assert.equal((await call('agent-runs',secondBody,g)).data.id,second.data.id);assert.equal(jobs.size,3);
  remoteStatus='completed';const before=polls;
  assert.equal((await call('business-reviews/'+g)).data.status,'not_generated');assert.equal((await call('agent-runs/'+third.data.id,undefined,g)).data.status,'queued');await call('agent-runs',undefined,g);assert.equal(polls,before);
  await pump.tick();assert.ok(polls>before);assert.equal((await call('agent-runs/'+third.data.id,undefined,g)).data.status,'completed');assert.equal((await call('business-reviews/'+g)).data.status,'not_generated');
  const p=(await call('business-profile')).data.profile;await call('business-profile',{baseVersion:p.version,profile:{...profile,name:'新代次'}});const next=(await call('business-generations')).data.generations[0].id;
  const continued=await call('agent-runs',{...secondBody,requestId:'new-generation'},next);assert.equal(continued.status,202);assert.equal(continued.data.sessionId,sessionId);assert.equal([...jobs.values()].at(-1).envelope.conversation.versionChanged,true);
 }finally{await pump.stop();await new Promise(r=>server.close(r));await mf.dispose();}
});
