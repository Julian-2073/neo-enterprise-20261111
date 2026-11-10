import type {Context} from './auth.ts';
import {all,first,statement} from './store.ts';
import {assert,ApiError} from './errors.ts';
import {hash} from './csv.ts';
import {currentBusinessGeneration} from './business-head.ts';
import {enterpriseResult,forecastGeneration,evaluateEnterpriseForecast} from './forecast-enterprise.ts';
import {activeAssumptions,forecastPublicationGuard} from './forecast-assumptions.ts';
import {storeBusinessArtifact,loadBusinessArtifact} from './business-artifact-storage.ts';
import {OPERATING_PLANNER_VERSION,plannerProblem,validateMission,validateLevers,type PlannerProblem,type PlannerSolution,type ReplenishmentLever} from '../lib/operating-planner.ts';
import {readStoredResult} from './agent-state.ts';
import {plusDays} from '../lib/business-metrics.ts';

type Plan={id:string;businessId:string;dataNature:string;generationId:string;forecastJobId:string;assumptionSetId:string|null;problem:PlannerProblem;solution:PlannerSolution;levers:ReplenishmentLever[];createdAt:string;createdBy:string};
async function saved(ctx:Context,nature:string,id:string){const row=await first<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE id=? AND business_id=? AND data_nature=? AND kind='operating_plan'",id,ctx.businessId,nature);assert(row,404,'OPERATING_PLAN','经营任务不存在');return loadBusinessArtifact<Plan>(ctx,nature,'operating_plan',row.payload);}
async function stale(ctx:Context,nature:string,p:Plan){const head=await currentBusinessGeneration(ctx,nature),latest=await first<{id:string}>(ctx.db,"SELECT id FROM neo_artifacts WHERE business_id=? AND data_nature=? AND snapshot_id=? AND kind='forecast_assumptions' ORDER BY created_at DESC,id DESC LIMIT 1",ctx.businessId,nature,p.generationId);return head?.id!==p.generationId||(latest?.id??null)!==p.assumptionSetId;}
function publicationGuard(ctx:Context,nature:string,generationId:string,setId?:string){const guard=forecastPublicationGuard(ctx,nature,generationId,setId);return setId?guard:{sql:guard.sql+" AND NOT EXISTS(SELECT 1 FROM neo_artifacts WHERE business_id=? AND data_nature=? AND snapshot_id=? AND kind='forecast_assumptions')",args:[...guard.args,ctx.businessId,nature,generationId]};}
const dto=(p:Plan)=>({id:p.id,businessId:p.businessId,dataNature:p.dataNature,generationId:p.generationId,forecastJobId:p.forecastJobId,assumptionSetId:p.assumptionSetId,mission:p.problem.mission,environment:p.problem.environment,coverage:p.problem.coverage,limitations:p.problem.limitations,solution:p.solution,levers:p.levers,createdAt:p.createdAt,createdBy:p.createdBy});

export async function operatingPlanInputs(ctx:Context,nature:string,generationId:string,jobId:string){
 const g=await forecastGeneration(ctx,nature,generationId),r=await enterpriseResult(ctx,nature,jobId),f=r.forecast;
 assert(f.generationId===g.id&&f.horizonDays===g.state.profile.horizonDays&&(await currentBusinessGeneration(ctx,nature))?.id===g.id,409,'OPERATING_SCOPE','选择同期限的最新资料与预测');
 const entities=[...new Set(f.points.map(p=>p.entityId))];
 return {generationId:g.id,forecastJobId:jobId,cashBudgetCents:g.state.profile.cashBudgetCents,ready:f.samples.length===32,series:entities.map(entityId=>({entityId,channelIds:[...new Set(f.points.filter(p=>p.entityId===entityId).map(p=>p.channelId))],warehouseIds:[...new Set(g.state.inputs.filter(v=>v.kind==='fulfillment_rule'&&v.entityId===entityId&&v.businessDate<=g.state.asOf).map(v=>v.warehouseId).filter(Boolean))]})),notice:'采购价格和额外费用需要填写依据；不从历史销售成本自动推定采购合同。'};
}
export async function readOperatingPlans(ctx:Context,nature:string,generationId:string,id?:string){
 if(id){const p=await saved(ctx,nature,id);assert(p.generationId===generationId,404,'OPERATING_SCOPE','经营任务不属于当前资料');return {...dto(p),needsUpdate:await stale(ctx,nature,p)};}
 const rows=await all<{id:string}>(ctx.db,"SELECT id FROM neo_artifacts WHERE business_id=? AND data_nature=? AND snapshot_id=? AND kind='operating_plan' ORDER BY created_at DESC,id DESC LIMIT 10",ctx.businessId,nature,generationId);
 const plans=await Promise.all(rows.map(async r=>{const p=await saved(ctx,nature,r.id);return {...dto(p),needsUpdate:await stale(ctx,nature,p)};}));
 const choices=await all<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE business_id=? AND data_nature=? AND snapshot_id=? AND kind='operating_plan_choice' ORDER BY created_at DESC LIMIT 20",ctx.businessId,nature,generationId);
 const reviews=await all<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE business_id=? AND data_nature=? AND snapshot_id=? AND kind='operating_plan_evaluation' ORDER BY created_at DESC LIMIT 20",ctx.businessId,nature,generationId);
 return {plans,choices:choices.map(r=>JSON.parse(r.payload)),reviews:reviews.map(r=>JSON.parse(r.payload))};
}
export async function createOperatingPlan(ctx:Context,nature:string,body:Record<string,unknown>){
 assert(typeof body.requestId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(body.requestId)&&typeof body.generationId==='string'&&typeof body.forecastJobId==='string'&&(body.assumptionSetId===undefined||typeof body.assumptionSetId==='string'),422,'OPERATING_REQUEST','需要稳定请求、资料代次、模型与可选环境版本');
 let mission,levers;try{mission=validateMission(body.mission);levers=validateLevers(body.levers);}catch(e){throw new ApiError(422,'OPERATING_CONDITIONS',(e as Error).message);}
 const requestId=nature+':'+body.requestId,requestHash=await hash(JSON.stringify({version:OPERATING_PLANNER_VERSION,generationId:body.generationId,forecastJobId:body.forecastJobId,assumptionSetId:body.assumptionSetId??null,mission,levers}));
 const prior=await first<{payload:string;request_hash:string}>(ctx.db,"SELECT payload,request_hash FROM neo_artifacts WHERE business_id=? AND kind='operating_plan' AND request_id=?",ctx.businessId,requestId);
 if(prior){assert(prior.request_hash===requestHash,409,'REQUEST_CONFLICT','同一请求已用于不同经营任务');const p=await loadBusinessArtifact<Plan>(ctx,nature,'operating_plan',prior.payload);return {...dto(p),needsUpdate:await stale(ctx,nature,p),reused:true};}
 const g=await forecastGeneration(ctx,nature,body.generationId),r=await enterpriseResult(ctx,nature,body.forecastJobId);
 assert((await currentBusinessGeneration(ctx,nature))?.id===g.id&&r.forecast.generationId===g.id&&g.salesForecast,409,'OPERATING_STALE','经营任务需要最新同代次预测');
 const latest=await first<{id:string}>(ctx.db,"SELECT id FROM neo_artifacts WHERE business_id=? AND data_nature=? AND snapshot_id=? AND kind='forecast_assumptions' ORDER BY created_at DESC,id DESC LIMIT 1",ctx.businessId,nature,g.id);
 assert((latest?.id??null)===(body.assumptionSetId??null),409,'OPERATING_ENVIRONMENT','环境条件已更新，请使用最新保存版本');
 const set=body.assumptionSetId?await activeAssumptions(ctx,nature,body.assumptionSetId,g.id,g.state.asOf,g.state.profile.horizonDays):null;
 let problem:PlannerProblem;try{problem=plannerProblem(g.state,g.salesForecast,r.forecast,body.forecastJobId,set,mission,levers);}catch(e){throw new ApiError(422,'OPERATING_DATA',(e as Error).message);}
 const base=ctx.runtime.NEO_OFFLINE_AGENT_URL??ctx.runtime.NEO_AGENT_URL;assert(base&&ctx.runtime.NEO_SERVICE_TOKEN,503,'OPERATING_SERVICE','数值求解服务未连接');
 let solution:PlannerSolution;try{const response=await fetch(base.replace(/\/$/,'')+'/operating-plans',{method:'POST',headers:{Authorization:`Bearer ${ctx.runtime.NEO_SERVICE_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({problem}),signal:AbortSignal.timeout(20000)});assert(response.ok,503,'OPERATING_SERVICE','经营求解未完成，请保留条件并重试');solution=await response.json() as PlannerSolution;}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(503,'OPERATING_SERVICE','经营求解暂未响应');}
 assert(solution.version===OPERATING_PLANNER_VERSION&&['optimal','time_limit','infeasible'].includes(solution.status)&&solution.executionStatus==='draft_only'&&solution.goal===mission.goal&&solution.riskAversion===mission.riskAversion,503,'OPERATING_RESULT','求解返回范围无效');
 const options=problem.groups.flatMap(g=>g.options);assert(new Set(solution.selectedOptionIds).size===solution.selectedOptionIds.length&&solution.selectedOptionIds.every(id=>options.some(o=>o.id===id)),503,'OPERATING_RESULT','求解选择了不存在的数量档');
 if(solution.status!=='infeasible'){
  const chosen=options.filter(o=>solution.selectedOptionIds.includes(o.id));
  assert(chosen.length===problem.groups.length&&problem.groups.every(g=>g.options.filter(o=>solution.selectedOptionIds.includes(o.id)).length===1)&&solution.cashCents===chosen.reduce((n,o)=>n+o.cashCents,0)&&solution.cashCents<=mission.cashBudgetCents&&JSON.stringify(solution.actions)===JSON.stringify(chosen.filter(o=>o.action).map(o=>o.action)),503,'OPERATING_RESULT','行动、预算或选择组合无效');
  const margins=problem.base.margin.map((v,i)=>v+chosen.reduce((n,o)=>n+o.deltaMargin[i],0)),units=problem.base.fulfilled.map((v,i)=>v+chosen.reduce((n,o)=>n+o.deltaFulfilled[i],0));
  assert(Number.isFinite(solution.expectedMarginCents)&&Math.abs(solution.expectedMarginCents!-margins.reduce((n,v)=>n+v,0)/32)<.01&&Number.isFinite(solution.expectedFulfilled)&&Math.abs(solution.expectedFulfilled!-units.reduce((n,v)=>n+v,0)/32)<1e-6&&Number.isFinite(solution.expectedRequested)&&Math.abs(solution.expectedRequested-problem.base.requested.reduce((n,v)=>n+v,0)/32)<1e-6&&(solution.expectedRequested===0?solution.expectedFillRate===null&&mission.minFillRate===0:solution.expectedFillRate!==null&&Math.abs(solution.expectedFillRate-solution.expectedFulfilled!/solution.expectedRequested)<1e-7&&solution.expectedFillRate+1e-7>=mission.minFillRate),503,'OPERATING_RESULT','求解数值与冻结情景不符');
 }
 const id='operating-plan-'+await hash(JSON.stringify([ctx.businessId,nature,body.requestId])),p:Plan={id,businessId:ctx.businessId,dataNature:nature,generationId:g.id,forecastJobId:body.forecastJobId,assumptionSetId:set?.id??null,problem,solution,levers,createdAt:new Date().toISOString(),createdBy:ctx.userId};
 const guard=publicationGuard(ctx,nature,g.id,set?.id),payload=await storeBusinessArtifact(ctx,nature,'operating_plan',p);
 try{await statement(ctx.db,`INSERT INTO neo_artifacts(id,business_id,data_nature,snapshot_id,kind,request_id,request_hash,parent_id,payload,created_at) SELECT ?,?,?,?,'operating_plan',?,?,?,?,? WHERE ${guard.sql}`,id,ctx.businessId,nature,g.id,requestId,requestHash,body.forecastJobId,payload,p.createdAt,...guard.args).run();}catch{throw new ApiError(409,'REQUEST_CONFLICT','经营任务已被并发保存，请回读原请求');}
 assert(await first(ctx.db,'SELECT id FROM neo_artifacts WHERE id=?',id),409,'OPERATING_STALE','资料或环境在求解时更新，请重新计算');return {...dto(p),needsUpdate:false};
}

export async function operatingPlanForAgent(ctx:Context,nature:string,id:string,generationId:string){const p=await saved(ctx,nature,id);assert(p.generationId===generationId&&!await stale(ctx,nature,p),409,'OPERATING_STALE','LLM调度须使用当前资料和环境的经营任务');const feedback=await all<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE business_id=? AND data_nature=? AND kind='operating_plan_evaluation' AND json_extract(payload,'$.actualGenerationId')=? ORDER BY created_at DESC LIMIT 10",ctx.businessId,nature,generationId);return {id:p.id,problem:p.problem,solution:p.solution,createdAt:p.createdAt,feedback:feedback.map(r=>JSON.parse(r.payload))};}

export async function evaluateOperatingPlan(ctx:Context,nature:string,id:string,body:Record<string,unknown>){
 assert(typeof body.actualGenerationId==='string',422,'OPERATING_ACTUAL','请选择后续实际资料');const p=await saved(ctx,nature,id),evaluation=await evaluateEnterpriseForecast(ctx,nature,{jobId:p.forecastJobId,actualGenerationId:body.actualGenerationId,...(p.assumptionSetId?{assumptionSetId:p.assumptionSetId}:{})}),ident='operating-evaluation-'+await hash(JSON.stringify([id,body.actualGenerationId]));
 const old=await first<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE id=? AND business_id=? AND data_nature=? AND kind='operating_plan_evaluation'",ident,ctx.businessId,nature);if(old)return JSON.parse(old.payload);
 const value={id:ident,businessId:ctx.businessId,dataNature:nature,generationId:p.generationId,planningId:id,actualGenerationId:body.actualGenerationId,forecastEvaluationId:evaluation.id,forecastStatus:evaluation.evaluation.status,forecastMetrics:evaluation.evaluation.metrics,fva:evaluation.fva,actualFulfilled:null,actualActionProfitCents:null,executionStatus:'not_recorded',notice:'对照保存预测与后续支付实际；没有履约及执行凭据，不能把支付销量当履约量，也不能验收行动收益。',createdAt:new Date().toISOString()};
 await statement(ctx.db,"INSERT OR IGNORE INTO neo_artifacts(id,business_id,data_nature,snapshot_id,kind,request_id,request_hash,parent_id,payload,created_at) VALUES(?,?,?,?,'operating_plan_evaluation',?,?,?,?,?)",ident,ctx.businessId,nature,p.generationId,ident,await hash(JSON.stringify([id,body.actualGenerationId])),id,JSON.stringify(value),value.createdAt).run();return value;
}

/** Conditional calculations are readable evidence, never raw operating facts. */
export async function operatingPlanEvidence(ctx:Context,nature:string,id:string,snapshotId:string|null){
 let p:Plan,solution:PlannerSolution;
 if(id.startsWith('operating-preview-')){
  const row=await first<{result:string;snapshot_id:string}>(ctx.db,"SELECT result,snapshot_id FROM neo_runs WHERE business_id=? AND data_nature=? AND json_extract(result,'$.operatingCalculation.id')=?",ctx.businessId,nature,id);assert(row,404,'OPERATING_EVIDENCE','尚无保存的LLM求解引用');
  const calculation=readStoredResult(row.result).result?.operatingCalculation as {planningId:string;generationId:string;businessId:string;dataNature:string;solution:PlannerSolution}|undefined;
  assert(calculation&&calculation.businessId===ctx.businessId&&calculation.dataNature===nature&&calculation.generationId===row.snapshot_id,404,'OPERATING_EVIDENCE','求解引用范围不符');p=await saved(ctx,nature,calculation.planningId);solution=calculation.solution;
 }else{p=await saved(ctx,nature,id);solution=p.solution;}
 assert(!snapshotId||p.generationId===snapshotId,404,'OPERATING_EVIDENCE','计算证据与查看资料不同');
 const g=await forecastGeneration(ctx,nature,p.generationId),limitations=['这是冻结资料与声明环境下的条件计算，不是已发生经营事实或实际收益。',...p.problem.limitations],title='经营目标与补货求解依据';
 const records=[{id:p.id+':mission',value:p.problem.mission},...p.levers.map((l,i)=>({id:p.id+':lever-'+i,value:l}))];
 return {evidence:{id,snapshotId:p.generationId,businessId:ctx.businessId,dataNature:nature,title,value:{mission:p.problem.mission,solution,environment:p.problem.environment,forecastJobId:p.forecastJobId,assumptionSetId:p.assumptionSetId},formula:'冻结支付预测整窗残差与未来判断共同抽样；按原履约顺序计算各SKU数量档，再在预算和服务目标内优化条件均值与最差10%尾部。',sourceCount:records.length,periodStart:plusDays(g.state.asOf,1),periodEnd:plusDays(g.state.asOf,g.state.profile.horizonDays),asOf:g.state.asOf,scopeLabel:'已预测SKU与声明补货数量档；经营与供货条件单独核对',limitations},analysis:{version:'evidence-analysis-v1',judgment:{title:solution.status==='infeasible'?'目标约束无可行组合':'已有条件行动草案',summary:solution.notice,nextStep:'先核对供货报价、交期与资金，再记录经营选择；没有执行凭据不计算实际行动收益。'},metrics:[{label:'条件平均贡献毛利',value:solution.expectedMarginCents,unit:'人民币分'},{label:'条件平均履约量',value:solution.expectedFulfilled,unit:'件'},{label:'新增现金占用',value:solution.cashCents,unit:'人民币分'},{label:'条件平均履约率',value:solution.expectedFillRate,unit:'比例'}],observations:[p.problem.environment.notice,'模型任务与环境版本固定引用；资料更新不覆盖旧计算。'],limitations},sources:[{kind:'operating_conditions',batch_id:p.id,filename:'已保存经营与供货条件',source_name:'人工声明条件与数值求解',recordCount:records.length,downloadUrl:null}],records:records.map((r,i)=>({id:r.id,kind:'operating_conditions',row_number:i+1,payload:JSON.stringify(r.value),batch_id:p.id,filename:'已保存条件'})),nextCursor:null};
}

export async function selectOperatingPlan(ctx:Context,nature:string,id:string,body:Record<string,unknown>){
 assert(ctx.role==='admin',403,'OPERATING_CHOICE','经营选择需要管理员');assert(typeof body.requestId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(body.requestId)&&typeof body.reason==='string'&&body.reason.trim().length>0&&body.reason.length<=2000,422,'OPERATING_CHOICE','需要稳定请求和选择理由');
 const p=await saved(ctx,nature,id);assert(p.solution.status!=='infeasible'&&p.problem.mission.confirmed&&p.levers.every(l=>l.confirmed),409,'OPERATING_CONDITIONS','先核对经营与供货条件，无可行解不能保存选择');
 const requestHash=await hash(JSON.stringify([id,body.reason])),requestId=nature+':'+body.requestId,prior=await first<{payload:string;request_hash:string}>(ctx.db,"SELECT payload,request_hash FROM neo_artifacts WHERE business_id=? AND kind='operating_plan_choice' AND request_id=?",ctx.businessId,requestId);
 if(prior){assert(prior.request_hash===requestHash,409,'REQUEST_CONFLICT','选择请求已用于不同方案');return JSON.parse(prior.payload);}
 assert(!await stale(ctx,nature,p),409,'OPERATING_STALE','资料或环境已变化，旧求解只能回看');
 const value={id:'operating-choice-'+crypto.randomUUID(),businessId:ctx.businessId,dataNature:nature,generationId:p.generationId,planningId:id,forecastJobId:p.forecastJobId,assumptionSetId:p.assumptionSetId,reason:body.reason.trim(),solution:p.solution,createdAt:new Date().toISOString(),createdBy:ctx.userId,executionStatus:'not_executed',actualOutcome:null},guard=publicationGuard(ctx,nature,p.generationId,p.assumptionSetId??undefined);
 await statement(ctx.db,`INSERT INTO neo_artifacts(id,business_id,data_nature,snapshot_id,kind,request_id,request_hash,parent_id,payload,created_at) SELECT ?,?,?,?,'operating_plan_choice',?,?,?,?,? WHERE ${guard.sql}`,value.id,ctx.businessId,nature,p.generationId,requestId,requestHash,id,JSON.stringify(value),value.createdAt,...guard.args).run();assert(await first(ctx.db,'SELECT id FROM neo_artifacts WHERE id=?',value.id),409,'OPERATING_STALE','条件在保存时更新，请回读最新任务');return value;
}
