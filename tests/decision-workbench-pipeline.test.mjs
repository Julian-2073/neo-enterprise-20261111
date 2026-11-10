import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {decodeInput} from '../server/input-storage.ts';
import {materialFixtures,fixtureCsv,seedSimIdentity,SIM_BUSINESS,simSnapshotInput} from '../scripts/materials-sim-fixture.mjs';
let mf,runtime,server;const jobs=new Map();
before(async()=>{
 ({mf,runtime}=await localRuntime());await seedSimIdentity(runtime.DB);
 server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;res.setHeader('Content-Type','application/json');
  try{const p=JSON.parse(body||'{}');
   if(req.url.startsWith('/calculate/')){
    const env=await decodeInput(JSON.stringify(p.envelope.envelopePacked?{storageFormat:'neo-inputs-gzip-v1',...p.envelope.envelopePacked}:p.envelope));
    const output=await new Promise((resolve,reject)=>{const child=spawn('agent-service/.venv/bin/python',['-c','import sys,json;from neo_agent.engine import simulate,compare;x=json.load(sys.stdin);print(json.dumps(simulate(x["env"]) if x["kind"]=="forecast" else compare(x["env"],x["assumptions"])))'],{env:{...process.env,PYTHONPATH:'agent-service'}});let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('error',reject);child.on('close',code=>code?reject(Error(err)):resolve(JSON.parse(out)));child.stdin.end(JSON.stringify({env,kind:req.url.split('/').at(-1),assumptions:p.assumptions??{}}));});res.end(JSON.stringify(output));
   }else if(req.url==='/runs'){
    // Explicitly offline model transport; the calculation above is the real Python engine.
    const env=await decodeInput(JSON.stringify(p.envelope.envelopePacked?{storageFormat:'neo-inputs-gzip-v1',...p.envelope.envelopePacked}:p.envelope)),basis=env.homeDecisionContext;
    assert.ok(basis);const block={title:'OFFLINE_HOME_TRANSPORT_TEST',summary:'仅验证保存和读取，不是在线 AI 判断',evidenceIds:[Object.values(env.snapshot.evidenceIds)[0]]};
    const value={id:p.id,status:'completed',steps:[],result:{finding:{conclusion:block.summary,evidenceIds:block.evidenceIds,gaps:['仍需确认作用假设'],homeDecision:{judgment:block,outlook:{forecastId:basis.forecast.id,title:block.title,summary:block.summary},action:{...block,steps:['核对到货']},sections:{conversion:block,supply:block,market:block},knowledgeVersion:basis.knowledgeVersion,knowledgeRuleIds:['K01']}},homeDecisionBasis:basis,specialists:{},marketEvidence:[]}};jobs.set(p.id,value);res.end(JSON.stringify(value));
   }else res.end(JSON.stringify(jobs.get(req.url.split('/')[2])));
  }catch(e){res.writeHead(422);res.end(JSON.stringify({detail:e.message}));}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));runtime={...runtime,agentExecutionMode:'live',manualAgentBusinesses:[SIM_BUSINESS],manualMarketBusinesses:[],NEO_AGENT_URL:`http://127.0.0.1:${server.address().port}`,NEO_SERVICE_TOKEN:'test'};
});
after(async()=>{await mf?.dispose();await new Promise(r=>server?.close(r));});
async function request(path,method='GET',body,business=SIM_BUSINESS,rt=runtime){const r=await handleApi(new Request(`http://localhost/api/v1/${path}${path.includes('?')?'&':'?'}businessId=${business}`,{method,headers:{origin:'http://localhost',...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),rt);return {status:r.status,data:await r.json()};}
async function ingest(kind,csv){const form=new FormData();for(const [k,v] of Object.entries({kind,templateVersion:'2',dataNature:'demo',sourceName:'DECISION_PIPELINE_TEST',coverageStart:'2026-04-06',coverageEnd:'2026-09-24'}))form.set(k,v);form.set('file',new File([csv],'decision.csv'));const uploaded=await request('ingestion-batches','POST',form);assert.equal(uploaded.data.batch.status,'ready',JSON.stringify(uploaded));const committed=await request(`ingestion-batches/${uploaded.data.batch.id}/commit`,'POST',{validationVersion:uploaded.data.batch.validation_version});assert.equal(committed.status,200,JSON.stringify(committed));}
async function publish(){const r=await request('operating-snapshots','POST',{...simSnapshotInput,asOf:'2026-09-24',periodStart:'2026-04-06',periodEnd:'2026-09-20'});assert.equal(r.status,201,JSON.stringify(r));return r.data.snapshot;}
test('import → workbench → real forecast/scenario → durable decision → new import recalculates without altering old records',async()=>{
 for(const [kind,csv] of Object.entries(materialFixtures))await ingest(kind,csv);
 const first=await publish(),scope=s=>({snapshotId:s.id,dataNature:'demo'}),q=s=>`snapshotId=${s.id}&dataNature=demo`,path=s=>'decision-workbench?'+q(s);
 const read=await request(path(first));assert.equal(read.status,200,JSON.stringify(read));assert.equal(read.data.baseline,null);assert.equal(read.data.home.run,null);
 const prepared=await request(path(first),'POST',scope(first));assert.equal(prepared.status,202,JSON.stringify(prepared));assert.equal(prepared.data.home.run.status,'completed');assert.equal(prepared.data.baseline.unit,'件');assert.equal(prepared.data.baseline.calculationVersion,'scenario-v1.3');
 const baseline=prepared.data.baseline;
 const assumptions={arrivals:[{skuId:'sim-r1-red',warehouseId:'sim-east',date:'2026-09-25',units:100,assumption:{source:'user_assumption',note:'仅用于隔离测试的到货假设',confirmed:true}}]};
 const calculated=await request('scenarios?'+q(first),'POST',{...scope(first),requestId:'pipeline-scenario',baselineId:baseline.id,title:'先核查并保供',assumptions});assert.equal(calculated.status,201,JSON.stringify(calculated));assert.equal(calculated.data.inputHash,baseline.inputHash);assert.ok(calculated.data.sensitivity);assert.ok(calculated.data.totals.endingUnits>=baseline.totals.endingUnits);
 const plan={owner:'隔离测试负责人',dueDate:'2026-10-08',steps:['核对到货'],observationMetrics:['商品销量','贡献毛利']},body={...scope(first),requestId:'pipeline-choice',scenarioId:calculated.data.id,title:'隔离测试经营选择',reason:'确认用于演练的条件，尚未执行',plan};
 const saved=await request('decisions?'+q(first),'POST',body);assert.equal(saved.status,201,JSON.stringify(saved));assert.equal(saved.data.actualOutcome,null);assert.deepEqual(saved.data.plan,plan);
 const again=await request('decisions?'+q(first),'POST',body);assert.equal(again.data.id,saved.data.id);
 const fixed=await request(path(first));assert.deepEqual(fixed.data.decisions[0].plan,plan);assert.equal(fixed.data.decisions[0].selectedScenario.id,calculated.data.id);
 assert.equal((await request('decisions?'+q(first),'POST',{...body,requestId:'invalid-plan',plan:{...plan,dueDate:'2026-02-30'}})).status,422);
 const nextOrders=fixtureCsv(['source_record_id','order_id','order_line_id','entry_type','occurred_at','channel','product_id','sku_id','quantity','amount_cents','variable_cost_cents','identity_namespace','external_contact_id'],[['decision-new','decision-order','decision-line','paid','2026-09-18T10:00:00','sim-douyin','sim-r1','sim-r1-red',5,500000,300000,'sim-platform','sim-external1']]);await ingest('orders',nextOrders);
 const next=await publish();assert.notEqual(next.id,first.id);
 const changed=await request(path(next),'POST',scope(next));assert.equal(changed.status,202,JSON.stringify(changed));assert.notEqual(changed.data.baseline.id,baseline.id);assert.notEqual(changed.data.baseline.inputHash,baseline.inputHash);assert.notDeepEqual(changed.data.history,read.data.history);assert.equal(changed.data.scenarios.length,0);assert.equal(changed.data.decisions.length,0);
 const old=await request(path(first));assert.deepEqual(old.data.baseline,baseline);assert.deepEqual(old.data.decisions[0].plan,plan);
 assert.equal((await request(path(first),'GET',undefined,'test-b')).status,404);assert.equal((await request(path(first).replace('dataNature=demo','dataNature=business'))).status,404);
 assert.equal((await request(path(first),'POST',{...scope(first),refresh:'true'})).status,422);
 const foreign=await request('scenarios?'+q(next),'POST',{...scope(next),requestId:'cross-snapshot',baselineId:baseline.id,assumptions:{}});assert.equal(foreign.status,409);
 const missing=await request(path(first)+'&baselineId=unknown');assert.equal(missing.data.baseline,null);assert.ok(missing.data.notice);
});
