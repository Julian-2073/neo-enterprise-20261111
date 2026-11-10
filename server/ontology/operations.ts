import {decisionPlan} from '../decision-plan.ts';
import {buildMetadata,querySql} from './query.ts';
import {transportEnvelope} from './transport.ts';
import {resultStatements,resultArtifact} from './results.ts';
import {agentPolicy} from './policy.ts';
import {definitionDiff} from './definitions.ts';
import {prepareEdit,commitEdit} from './edits.ts';
import {forecastAvailability} from '../../lib/forecast-availability.ts';
import {sameCalculation} from '../../lib/decision-history.ts';
import type {Context} from '../auth.ts';
import {requireWrite} from '../auth.ts';
import {assert,ApiError} from '../errors.ts';
import {first,statement} from '../store.ts';
import {hash} from '../csv.ts';
import {handleAgents,service} from '../agents.ts';
import {queryObjects,type ObjectQuery} from './model.ts';
import {definition,publishDraft,getBuild,buildData,capture,createBuild,envelopeForBuild,nature,text,now,uid} from './store.ts';
export type RunRow={id:string;business_id:string;data_nature:string;build_id:string|null;kind:string;operation:string;request_id:string;request_hash:string;status:string;input:string;result:string|null;trace:string;error:string|null;actor_id:string;created_at:string;updated_at:string};
export function publicRun(r:RunRow){return {id:r.id,businessId:r.business_id,dataNature:r.data_nature,buildId:r.build_id,kind:r.kind,operation:r.operation,status:r.status,input:JSON.parse(r.input),result:r.result?JSON.parse(r.result):null,trace:JSON.parse(r.trace).map((s:Record<string,unknown>,i:number)=>({...s,id:s.id??`${r.id}:${i}`,parentId:s.parentId??(i?`${r.id}:0`:null),startedAt:s.startedAt??s.at,endedAt:s.endedAt??s.at})),traceDetail:JSON.parse(r.trace).some((s:Record<string,unknown>)=>s.inputRef||s.outputRef)?'referenced_steps':'legacy_steps',error:r.error,createdAt:r.created_at,updatedAt:r.updated_at};}
export async function getRun(ctx:Context,id:unknown){const r=await first<RunRow>(ctx.db,'SELECT * FROM ontology_runs WHERE id=? AND business_id=?',text(id,'runId'),ctx.businessId);assert(r,404,'NOT_FOUND','运行记录不存在');return r;}
function stable(x:unknown):unknown{return Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):x;}
export async function execute(ctx:Context,input:Record<string,unknown>,kind:string,operation:string,work:(trace:Array<Record<string,unknown>>,runId:string)=>Promise<unknown>){
 const n=nature(input.dataNature),requestId=text(input.requestId,'requestId',100),digest=await hash(JSON.stringify(stable({kind,operation,input})));const id=uid('ontology-run');
 await statement(ctx.db,"INSERT OR IGNORE INTO ontology_runs(id,business_id,data_nature,build_id,kind,operation,request_id,request_hash,status,input,result,trace,error,actor_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?, 'running',?,NULL,'[]',NULL,?,?,?)",id,ctx.businessId,n,typeof input.buildId==='string'?input.buildId:null,kind,operation,requestId,digest,JSON.stringify(input),ctx.userId,now(),now()).run();
 const saved=await first<RunRow>(ctx.db,'SELECT * FROM ontology_runs WHERE business_id=? AND request_id=?',ctx.businessId,requestId);assert(saved?.request_hash===digest,409,'REQUEST_CONFLICT','请求ID用于不同内容');if(saved.id!==id)return publicRun(saved);
 const startedAt=now();const trace:Array<Record<string,unknown>>=[{id:`${id}:0`,parentId:null,startedAt,endedAt:startedAt,inputRef:{businessId:ctx.businessId,buildId:input.buildId??null},step:'scope',at:startedAt,status:'completed',businessId:ctx.businessId,dataNature:n,buildId:input.buildId??null}];
 try{
  const result=await work(trace,id);if((await getRun(ctx,id)).status==='completed')return publicRun(await getRun(ctx,id));assert(!(result&&typeof result==='object'&&'status' in result&&result.status==='failed'),422,'OPERATION_FAILED','操作未成功');const pending=result&&typeof result==='object'&&'agentRunId' in result;const runStatus=pending&&(result as {status?:string}).status==='pending_dispatch'?'pending_dispatch':pending?'dispatched':'completed';
  trace.push({id:`${id}:${trace.length}`,parentId:`${id}:0`,step:operation,startedAt,endedAt:now(),inputRef:{buildId:input.buildId??null},outputRef:result&&typeof result==='object'&&'id' in result?{resourceId:result.id}:null,at:now(),status:runStatus});
  await statement(ctx.db,'UPDATE ontology_runs SET status=?,result=?,trace=?,updated_at=? WHERE id=?',runStatus,JSON.stringify(result),JSON.stringify(trace),now(),id).run();
  await statement(ctx.db,'INSERT INTO audit_events(id,business_id,actor_id,action,resource_id,created_at) VALUES(?,?,?,?,?,?)',uid('audit'),ctx.businessId,ctx.userId,`ontology:${operation}`,id,now()).run();
 }catch(e){
  console.error('NEO Ontology operation failed',operation,e);
  const message=e instanceof ApiError?e.message:'运行失败，请检查服务或重试；没有返回演示结果';trace.push({step:operation,at:now(),status:'failed',error:message});
  await statement(ctx.db,"UPDATE ontology_runs SET status='failed',error=?,trace=?,updated_at=? WHERE id=?",message,JSON.stringify(trace),now(),id).run();
  if(e instanceof ApiError)throw e;throw new ApiError(503,'RUN_FAILED',message);
 }
 return publicRun(await getRun(ctx,id));
}
export const actionCatalog=[
 {id:'publish_definition',name:'发布类型与映射',role:'admin'},
 {id:'commit_import',name:'提交通用导入',role:'importer'},
 {id:'build_projection',name:'构建对象视图',role:'importer'},
 {id:'edit_property',name:'编辑业务属性',role:'admin'},
 {id:'save_decision',name:'保存老板选择',role:'importer'},
];
export const functionCatalog=[
 {id:'health',name:'计算与Agent服务健康',input:'服务配置',output:'已探测状态与接口版本',kind:'service',version:'health-v1'},
 {id:'count',name:'对象数量',input:'ObjectSet',output:'数量',kind:'query',version:'ontology-v1'},
 {id:'sum',name:'对象属性汇总',input:'ObjectSet + 数值属性',output:'值、单位及缺失数量',kind:'query',version:'ontology-v1'},
 {id:'metrics',name:'经营快照指标',input:'固定经营快照',output:'指标与来源',kind:'snapshot',version:'ingestion-v1.2'},
 {id:'forecast',name:'28天销量与库存基线',input:'固定经营快照对象视图',output:'预测与回测记录',kind:'python',version:'four-week-mean'},
 {id:'forecast_evaluate',name:'预测与实际销量评估',input:'预测基线 + 后续固定实际投影',output:'逐序列与逐折 WAPE、偏差及覆盖',kind:'python',version:'evaluation-v1'},
 {id:'scenario',name:'经营情景比较',input:'预测基线 + 明确假设',output:'方案、差异及限制',kind:'python',version:'scenario-v1'},
];
export const functionParameters:Record<string,unknown>={count:{query:'ObjectQuery'},sum:{query:'ObjectQuery',property:'numeric_property'},forecast:{buildId:'pinned_snapshot_projection'},scenario:{buildId:'pinned_snapshot_projection',baselineId:'forecast_in_same_projection',assumptions:'ScenarioAssumptions'},forecast_evaluate:{buildId:'forecast_input_projection',baselineId:'saved_forecast',actualBuildId:'later_paid_order_projection'},metrics:{buildId:'pinned_snapshot_projection'},health:{}};
export const registeredFunctions=functionCatalog.map(f=>({...f,parameters:functionParameters[f.id],inputScope:f.kind==='query'?'object_set':f.kind==='service'?'service_configuration':'enterprise_pinned_snapshot',writes:'result_layer'}));
export async function previewAction(ctx:Context,input:Record<string,unknown>){
 nature(input.dataNature);const operation=text(input.action,'action');assert(actionCatalog.some(a=>a.id===operation),422,'UNKNOWN_ACTION','动作未注册');
 assert(ctx.role!=='reader',403,'READ_ONLY','只读成员不能操作');if(['publish_definition','edit_property'].includes(operation))assert(ctx.role==='admin',403,'ADMIN_REQUIRED','仅管理员可操作');
 if(operation==='publish_definition'){
  const row=await first<{payload:string;base_id:string;status:string}>(ctx.db,'SELECT * FROM ontology_definitions WHERE id=? AND business_id=?',text(input.draftId,'draftId'),ctx.businessId);assert(row,404,'NOT_FOUND','草稿不存在');const current=await definition(ctx);
  assert(row.status==='published'||row.base_id===current.version,409,'VERSION_CONFLICT','草稿已过期');return {action:operation,changes:{from:row.base_id,to:input.draftId,types:JSON.parse(row.payload).types.length},diff:await definitionDiff(ctx,String(input.draftId),String(input.dataNature)),warning:'发布定义后需构建新对象视图；旧结果不变'};
 }
 if(operation==='commit_import'){
  const row=await first<{status:string;rows:string;definition_id:string}>(ctx.db,'SELECT * FROM ontology_imports WHERE id=? AND business_id=? AND data_nature=?',text(input.batchId,'batchId'),ctx.businessId,input.dataNature);assert(row,404,'NOT_FOUND','批次不存在');assert(['ready','committed'].includes(row.status),409,'BATCH_NOT_READY','批次尚未校验通过');
  assert((await definition(ctx)).version===row.definition_id,409,'VERSION_CONFLICT','映射版本已变化，请重新校验上传');return {action:operation,changes:{rows:JSON.parse(row.rows).length,batchId:input.batchId},warning:'提交后构建对象视图，不改原始事实'};
 }
 if(operation==='build_projection'){
  const c=await capture(ctx,input);return {action:operation,changes:{facts:c.data.facts.length+(c.data.operating?.inputs.length??0),imports:c.data.imports.reduce((n,b)=>n+b.rows.length,0),definitionId:c.definition.version,asOf:c.asOf,knownAt:c.knownAt},warning:'仅发布完成的投影；失败保留旧版本'};
 }
 if(operation==='edit_property')return (await prepareEdit(ctx,input)).preview;
 const d=await buildData(ctx,input.buildId,input.dataNature);const scenario=await first<{payload:string;snapshot_id:string}>(ctx.db,"SELECT * FROM neo_artifacts WHERE id=? AND business_id=? AND data_nature=? AND kind='scenario'",text(input.scenarioId,'scenarioId'),ctx.businessId,input.dataNature);assert(scenario&&scenario.snapshot_id===d.build.snapshot_id,404,'NOT_FOUND','方案不属于当前范围');
 const saved=JSON.parse(scenario.payload);assert(saved.ontologyRef?.buildId===d.build.id,409,'VERSION_CONFLICT','方案不属于当前对象版本');text(input.reason,'reason',4000);return {action:operation,changes:{scenarioId:input.scenarioId,reason:input.reason,plan:decisionPlan(input.plan)},warning:'保存选择不会执行采购、投放或产生实际收益'};
}
export async function submitAction(request:Request,ctx:Context,input:Record<string,unknown>){
 requireWrite(request,ctx);const op=text(input.action,'action');
 return execute(ctx,input,'action',op,async (trace,runId)=>{
  await previewAction(ctx,input);
  trace.push({step:'validation',status:'completed',at:now()});
  if(op==='publish_definition')return publishDraft(ctx,String(input.draftId));
  if(op==='build_projection'){
   const result=await createBuild(ctx,input);trace.push({step:'projection',status:result.status==='failed'?'failed':'completed',at:now(),buildId:result.id,counts:result.counts});assert(result.status!=='failed',422,'PROJECTION_FAILED','投影校验失败；可在质量页查看问题，旧版本不变');return result;
  }
  if(op==='commit_import'){
   await statement(ctx.db,"UPDATE ontology_imports SET status='committed',committed_at=COALESCE(committed_at,?) WHERE id=? AND business_id=? AND status IN ('ready','committed')",now(),input.batchId,ctx.businessId).run();
   return {batchId:input.batchId,status:'committed',next:'build_projection'};
  }
  if(op==='edit_property')return commitEdit(ctx,input,runId,trace);
  const result=await legacyArtifact(ctx,input,'decision');trace.push({step:'decision_saved',at:now(),status:'completed',resourceId:result.id});return result;
 });
}
export async function legacyArtifact(ctx:Context,input:Record<string,unknown>,kind:'forecast'|'scenario'|'decision'){
 const data=await buildData(ctx,input.buildId,input.dataNature),env=await envelopeForBuild(ctx,data.build.id),ref=env.ontologyRef;
 assert(!data.build.snapshot_id?.startsWith('generation-'),409,'OPERATING_CALCULATION_SCOPE','此对象视图来自新经营代次；预测、方案与选择请使用该代次经营工作台，不能套用旧28天模型');
 assert(data.build.snapshot_id,422,'SNAPSHOT_REQUIRED','请先绑定经营快照');
 assert(data.build.known_at<=String(env.snapshot.generatedAt),409,'KNOWLEDGE_CHANGED','人工编辑产生了新的知识时点；请创建新经营快照后重新构建再计算');
 let parentId:string|null=null;let result:Record<string,unknown>;let selectedScenario:Record<string,unknown>|null=null;let calculationParent:Record<string,unknown>|null=null;
 if(kind==='scenario'||kind==='decision'){
  parentId=text(kind==='scenario'?input.baselineId:input.scenarioId,'parentId');const parent=await first<{payload:string;snapshot_id:string;kind:string}>(ctx.db,'SELECT * FROM neo_artifacts WHERE id=? AND business_id=? AND data_nature=?',parentId,ctx.businessId,input.dataNature);
  assert(parent&&parent.kind===(kind==='scenario'?'forecast':'scenario')&&parent.snapshot_id===data.build.snapshot_id,404,'NOT_FOUND','基线或方案不存在');assert(JSON.parse(parent.payload).ontologyRef?.buildId===data.build.id,409,'VERSION_CONFLICT','父结果不是当前对象版本');if(kind==='decision')selectedScenario=JSON.parse(parent.payload);else calculationParent=JSON.parse(parent.payload);
 }
 if(kind==='decision')result={scenarioId:parentId,selectedScenario,reason:text(input.reason,'reason',4000),plan:decisionPlan(input.plan),status:'saved_decision',actualOutcome:null};
 else{
  // Existing service performs strict numerical assumption validation; mirror the legacy provenance gate.
  const assumptions=input.assumptions as {adjustments?:Array<{assumption?:{source?:string;evidenceIds?:string[]}}> ;arrivals?:Array<{assumption?:{source?:string;evidenceIds?:string[]}}> ;transfers?:Array<{assumption?:{source?:string;evidenceIds?:string[]}}> ;extraCostAssumption?:{source?:string;evidenceIds?:string[]}}|undefined;
  const specs=[...(assumptions?.adjustments??[]),...(assumptions?.arrivals??[]),...(assumptions?.transfers??[])].map(x=>x.assumption);if(assumptions?.extraCostAssumption)specs.push(assumptions.extraCostAssumption);
  for(const a of specs){assert(a?.source!=='synthetic'||input.dataNature==='demo',422,'SYNTHETIC_PARAMETER','合成参数仅用于demo');if(a&&['historical_estimate','external_reference'].includes(a.source??'')){assert(a.evidenceIds?.length,422,'ASSUMPTION_EVIDENCE','估计或外部参数需要证据');for(const eid of a.evidenceIds){const found=Object.values((env.snapshot.evidenceIds??{}) as Record<string,string>).includes(eid)||await first(ctx.db,'SELECT id FROM neo_market_evidence WHERE id=? AND business_id=? AND snapshot_id=?',eid,ctx.businessId,data.build.snapshot_id);assert(found,422,'ASSUMPTION_EVIDENCE','证据不属于当前快照');}}}
  result=await service(ctx,`/calculate/${kind}`,{envelope:await transportEnvelope(env),assumptions:input.assumptions??{}});
    result={...result,backtestAvailability:forecastAvailability(env as unknown as Parameters<typeof forecastAvailability>[0])};
  if(calculationParent)assert(sameCalculation(result,calculationParent),409,'CALCULATION_CONFLICT','基线与方案的计算版本或输入资料不一致，或历史版本待核；请重新计算基线后再比较。');
 }
 const id=uid(kind),requestId=`ontology:${text(input.requestId,'requestId',100)}`,digest=await hash(JSON.stringify(input));
 const value={...result,resultLayerVersion:'ontology-results-v1',id,kind,parentId,snapshotId:data.build.snapshot_id,businessId:ctx.businessId,dataNature:input.dataNature,ontologyRef:ref,createdAt:now(),title:typeof input.title==='string'?input.title.slice(0,100):kind==='forecast'?'Ontology 销量基线':kind==='scenario'?'Ontology 经营方案':'已保存老板选择'};
 await ctx.db.batch([statement(ctx.db,'INSERT OR IGNORE INTO neo_artifacts(id,business_id,data_nature,snapshot_id,kind,request_id,request_hash,parent_id,payload,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,ctx.businessId,input.dataNature,data.build.snapshot_id,kind,requestId,digest,parentId,JSON.stringify(value),value.createdAt),...resultStatements(ctx,value)]);
 const saved=await first<{payload:string;request_hash:string}>(ctx.db,'SELECT * FROM neo_artifacts WHERE business_id=? AND kind=? AND request_id=?',ctx.businessId,kind,requestId);assert(saved?.request_hash===digest,409,'REQUEST_CONFLICT','结果请求内容冲突');return JSON.parse(saved.payload);
}
export async function runFunction(request:Request,ctx:Context,id:string,input:Record<string,unknown>){
 requireWrite(request,ctx);assert(functionCatalog.some(f=>f.id===id),422,'UNKNOWN_FUNCTION','函数未注册');if(id==='health')return execute(ctx,input,'function',id,async()=>{const result=await service(ctx,'/health');return {...result,serviceRef:ctx.runtime.NEO_AGENT_URL,ontologyReady:result.ontologyVersion==='objectset-v1',checkedAt:now()};});const data=['count','sum'].includes(id)?await buildMetadata(ctx,input.buildId,nature(input.dataNature)):await buildData(ctx,input.buildId,nature(input.dataNature));
 return execute(ctx,input,'function',id,async trace=>{
  trace.push({step:'object_view',status:'completed',at:now(),buildId:data.build.id,sourceHash:data.build.source_hash});
  if(id==='count'||id==='sum'){
   const q=(input.query??{typeId:'sku'}) as ObjectQuery;const aggregate=id==='count'?{op:'count' as const}:{op:'sum' as const,property:text(input.property,'property')};
   const r=await querySql(ctx,{...input,query:{...q,aggregate}});trace.push({step:'query_objects',at:now(),status:'completed',query:q,total:r.total});return {...r,ontologyRef:{buildId:data.build.id,definitionId:data.definition.version}};
  }
  assert(!input.query,422,'SNAPSHOT_FUNCTION_SCOPE','快照函数使用完整快照范围；请创建对应商品/渠道快照，不能忽略对象集筛选');
  if(id==='metrics'){const env=await envelopeForBuild(ctx,data.build.id);return {snapshotId:data.build.snapshot_id,ontologyRef:env.ontologyRef,data:env.snapshot.data,evidenceIds:env.snapshot.evidenceIds};}
  if(id==='forecast_evaluate'){assert(!data.build.snapshot_id?.startsWith('generation-'),409,'OPERATING_CALCULATION_SCOPE','新经营代次尚未评估预测误差，不能继承旧模型回测');const forecast=await resultArtifact(ctx,text(input.baselineId,'baselineId'),String(input.dataNature),data.build.id);assert(forecast.kind==='forecast',422,'FORECAST_REQUIRED','请选择预测基线');const actualBuild=await getBuild(ctx,input.actualBuildId,input.dataNature);assert(actualBuild.as_of>=data.build.as_of,422,'ACTUAL_SCOPE','实际资料必须来自后续时点');const env=await envelopeForBuild(ctx,actualBuild.id);const evaluation=await service(ctx,'/calculate/forecast_evaluate',{envelope:await transportEnvelope(env),forecast});const value={...evaluation,id:uid('forecast-evaluation'),kind:'forecast_evaluation',forecastId:forecast.id,parentId:forecast.id,businessId:ctx.businessId,dataNature:input.dataNature,snapshotId:data.build.snapshot_id,ontologyRef:forecast.ontologyRef,actualInputRef:env.ontologyRef,createdAt:now(),resultLayerVersion:'ontology-results-v1',title:'预测销量评估'};await ctx.db.batch([statement(ctx.db,'INSERT INTO neo_artifacts(id,business_id,data_nature,snapshot_id,kind,request_id,request_hash,parent_id,payload,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',value.id,ctx.businessId,input.dataNature,data.build.snapshot_id,value.kind,`ontology:${input.requestId}`,await hash(JSON.stringify(input)),forecast.id,JSON.stringify(value),value.createdAt),...resultStatements(ctx,value)]);return value;}
  const r=await legacyArtifact(ctx,input,id as 'forecast'|'scenario');trace.push({step:'calculation',status:'completed',at:now(),resourceId:r.id,ontologyRef:r.ontologyRef});return r;
 });
}
export async function runAgent(request:Request,ctx:Context,input:Record<string,unknown>){
 requireWrite(request,ctx);const data=await buildData(ctx,input.buildId,nature(input.dataNature));assert(!data.build.snapshot_id?.startsWith('generation-'),409,'OPERATING_AGENT_SCOPE','新经营代次请使用绑定同代次的经营审查入口；旧ObjectSet Agent仅适用旧快照');const env=await envelopeForBuild(ctx,data.build.id);Object.assign(env,{agentPolicy:agentPolicy(data.definition)});
 if(input.query){queryObjects(data.objects,data.links,data.definition,input.query as ObjectQuery);if(env.ontology)Object.assign(env.ontology,{requestedObjectSet:input.query});else Object.assign(env,{ontologyRequestedObjectSet:input.query});}
 return execute(ctx,input,'agent',text(input.mode,'mode'),async trace=>{
  const body={snapshotId:data.build.snapshot_id,dataNature:input.dataNature,question:text(input.question,'question',4000),mode:input.mode,requestId:`ontology:${input.requestId}`,purpose:'analysis'};
  const req=new Request(request.url.replace(/\/ontology\/.*$/,`/agent-runs?businessId=${encodeURIComponent(ctx.businessId)}`),{method:'POST',headers:request.headers,body:JSON.stringify(body)});
  const response=await handleAgents(req,ctx,['agent-runs'],env);assert(response,503,'AGENT_UNAVAILABLE','Agent适配器不可用');const result=await response.json() as Record<string,unknown>;assert(response.ok,response.status,'AGENT_RUN',((result.error as Record<string,unknown>)?.message as string)??'Agent任务未接受');trace.push({step:'agent_dispatch',at:now(),status:result.status,agentRunId:result.id,ontologyRef:env.ontologyRef});return {agentRunId:result.id,status:result.status,result:result.result,error:result.error,ontologyRef:env.ontologyRef};
 });
}
export async function refreshAgent(request:Request,ctx:Context,id:string){
 requireWrite(request,ctx);const r=await getRun(ctx,id);assert(r.kind==='agent'&&r.result,409,'NOT_AGENT','不是已派发Agent任务');const old=JSON.parse(r.result);const agentId=text(old.agentRunId,'agentRunId');
 const response=await handleAgents(new Request(request.url,{method:'GET'}),ctx,['agent-runs',agentId]);assert(response?.ok,503,'AGENT_REFRESH','Agent状态读取失败');const job=await response.json() as {status:string;result:Record<string,unknown>;steps:unknown[];error?:string};
 const trace=JSON.parse(r.trace);trace.push({step:'agent_refresh',at:now(),status:job.status,steps:job.steps,toolReads:job.result?.toolReads??[]});
 await statement(ctx.db,'UPDATE ontology_runs SET status=?,result=?,trace=?,error=?,updated_at=? WHERE id=?',job.result?.partial?'partial':job.status,JSON.stringify({...old,...job,agentRunId:agentId}),JSON.stringify(trace.slice(-30)),job.error??null,now(),r.id).run();return publicRun(await getRun(ctx,id));
}
// Recover a request interrupted by a process restart; reconcile saved effects before admitting a retry.
export async function recoverRun(request:Request,ctx:Context,id:string){
 requireWrite(request,ctx);const r=await getRun(ctx,id);assert(r.status==='running'&&Date.now()-Date.parse(r.created_at)>15*60*1000,409,'RECOVERY_WINDOW','仅超过15分钟且未完成的请求可恢复检查');const input=JSON.parse(r.input);let status='failed',result:unknown=null,error:string|null='请求中断；已检查保存状态。可重试；人工编辑若已记录，请先重新构建对象视图。';
 if(r.kind==='agent'){
  const job=await first<{id:string;status:string;payload:string;result:string|null;error:string|null}>(ctx.db,'SELECT * FROM neo_runs WHERE business_id=? AND request_id=?',ctx.businessId,`ontology:${r.request_id}`);
  if(job){status=['completed','failed','cancelled'].includes(job.status)?job.status:'pending_dispatch';result={agentRunId:job.id,status:job.status,result:job.result?JSON.parse(job.result):null,error:job.error,ontologyRef:JSON.parse(job.payload).envelope?.ontologyRef};error=job.error;}
 }else if(r.kind==='function'||r.operation==='save_decision'){
  const a=await first<{payload:string}>(ctx.db,'SELECT payload FROM neo_artifacts WHERE business_id=? AND request_id=? AND kind=?',ctx.businessId,`ontology:${r.request_id}`,r.operation==='save_decision'?'decision':r.operation);if(a){result=JSON.parse(a.payload);status='completed';error=null;}
 }else if(r.operation==='edit_property'){
  const e=await first<{result_build_id:string}>(ctx.db,"SELECT result_build_id FROM ontology_edits WHERE business_id=? AND run_id=? AND status='committed'",ctx.businessId,r.id);if(e){result=await getBuild(ctx,e.result_build_id,r.data_nature);status='completed';error=null;}else await statement(ctx.db,"UPDATE ontology_edits SET status='rejected' WHERE run_id=? AND status='staged'",r.id).run();
 }else if(r.operation==='commit_import'){
  const b=await first<{id:string}>(ctx.db,"SELECT id FROM ontology_imports WHERE business_id=? AND data_nature=? AND id=? AND status='committed'",ctx.businessId,r.data_nature,input.batchId);if(b){result={batchId:b.id,status:'committed',next:'build_projection'};status='completed';error=null;}
 }else if(r.operation==='publish_definition'){
  const d=await first<{id:string}>(ctx.db,"SELECT id FROM ontology_definitions WHERE business_id=? AND id=? AND status='published'",ctx.businessId,input.draftId);if(d){result={id:d.id,status:'published'};status='completed';error=null;}
 }
 const trace=JSON.parse(r.trace);trace.push({step:'recovery_check',at:now(),status,error});await statement(ctx.db,'UPDATE ontology_runs SET status=?,result=?,error=?,trace=?,updated_at=? WHERE id=? AND status=?',status,result?JSON.stringify(result):null,error,JSON.stringify(trace),now(),r.id,'running').run();return publicRun(await getRun(ctx,id));
}
