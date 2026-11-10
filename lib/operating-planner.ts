import type {BusinessState} from './business-state.ts';
import {calculateScenario,type ScenarioAction} from './business-scenarios.ts';
import {enterpriseAsSales,type EnterpriseForecast} from './forecast-enterprise.ts';
import type {SalesForecast} from './business-forecast.ts';
import {assumptionMultiplier,type AssumptionSet} from './forecast-assumptions.ts';
import {plusDays} from './business-metrics.ts';

export const OPERATING_PLANNER_VERSION='operating-planner-v1';
export type OperatingMission={goal:'contribution_margin'|'service';cashBudgetCents:number;minFillRate:number;riskAversion:number;sourceNote:string;confirmed:boolean};
export type ReplenishmentLever={entityId:string;warehouseId:string;leadDays:number;minUnits:number;maxUnits:number;stepUnits:number;unitCashCostCents:number;unitExtraExpenseCents:number;fixedCashCostCents:number;fixedExtraExpenseCents:number;sourceNote:string;confirmed:boolean};
export type PlannerOption={id:string;quantity:number;cashCents:number;action:ScenarioAction|null;deltaMargin:number[];deltaFulfilled:number[]};
export type PlannerProblem={version:string;businessId:string;dataNature:string;generationId:string;forecastJobId:string;assumptionSetId:string|null;mission:OperatingMission;base:{margin:number[];fulfilled:number[];requested:number[]};groups:Array<{id:string;options:PlannerOption[]}>;environment:{method:string;sampleCount:number;independentCalibrationBlocks:number;coupling:string;assumptionSetId:string|null;notice:string};coverage:{status:string;unestimatedEntityIds:string[]};limitations:string[]};
export type PlannerSolution={version:string;status:'optimal'|'time_limit'|'infeasible';selectedOptionIds:string[];actions:ScenarioAction[];goal:OperatingMission['goal'];riskAversion:number;cashCents:number;expectedMarginCents:number|null;expectedFulfilled:number|null;expectedRequested:number;expectedFillRate:number|null;conditionalMarginRange:number[]|null;conditionalFulfilledRange:number[]|null;downsideMarginCents:number|null;solver:{name:string;version:string;gap:number|null;seconds:number;optimalWithinDeclaredGrid:boolean};notice:string;executionStatus:'draft_only'};

function integer(n:unknown,max=10000000000){return Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<=max;}
export function validateMission(value:unknown):OperatingMission{
 const m=value as OperatingMission;
 if(!m||!['contribution_margin','service'].includes(m.goal)||!integer(m.cashBudgetCents)||!Number.isFinite(m.minFillRate)||m.minFillRate<0||m.minFillRate>1||!Number.isFinite(m.riskAversion)||m.riskAversion<0||m.riskAversion>2||typeof m.sourceNote!=='string'||!m.sourceNote.trim()||m.sourceNote.length>1000||typeof m.confirmed!=='boolean')throw Error('经营目标、预算、服务目标、风险偏好和条件依据必须完整');
 return {goal:m.goal,cashBudgetCents:m.cashBudgetCents,minFillRate:m.minFillRate,riskAversion:m.riskAversion,sourceNote:m.sourceNote.trim(),confirmed:m.confirmed};
}
export function validateLevers(value:unknown):ReplenishmentLever[]{
 if(!Array.isArray(value)||!value.length||value.length>8)throw Error('本轮支持1至8个SKU的补货数量，每个SKU一个目的仓');
 const levers=value as ReplenishmentLever[];
 for(const l of levers){
  if(!l||typeof l.entityId!=='string'||!l.entityId||l.entityId.length>160||typeof l.warehouseId!=='string'||!l.warehouseId||l.warehouseId.length>160||!integer(l.leadDays,90)||!integer(l.minUnits,10000)||!integer(l.maxUnits,10000)||l.minUnits>l.maxUnits||!integer(l.stepUnits,10000)||l.stepUnits<1||!['unitCashCostCents','unitExtraExpenseCents','fixedCashCostCents','fixedExtraExpenseCents'].every(k=>integer(l[k as keyof ReplenishmentLever]))||typeof l.sourceNote!=='string'||!l.sourceNote.trim()||l.sourceNote.length>1000||typeof l.confirmed!=='boolean')throw Error('补货范围、交期、现金成本、额外费用和依据无效');
  if(Math.floor((l.maxUnits-(l.minUnits||l.stepUnits))/l.stepUnits)+2>17)throw Error('每个SKU最多16个非零数量档，请增大步长');
 }
 if(new Set(levers.map(l=>l.entityId)).size!==levers.length)throw Error('同SKU不能重复设置补货变量');
 return levers.map(l=>({...l,sourceNote:l.sourceNote.trim()}));
}

/** A frozen, deterministic fulfillment policy is evaluated before the solver.
 * Each SKU has independent stock and rules; only budget couples its action grid.
 * This avoids giving future allocations access to tomorrow's realized demand.
 */
export function plannerProblem(state:BusinessState,basis:SalesForecast,f:EnterpriseForecast,forecastJobId:string,set:AssumptionSet|null,mission:OperatingMission,levers:ReplenishmentLever[]):PlannerProblem{
 if(state.profile.industry!=='ecommerce'||f.horizonDays!==state.profile.horizonDays||f.origin!==state.asOf)throw Error('经营求解需要同代次、同期限的电商支付预测');
 if(f.samples.length!==32)throw Error('独立校准残差样本不足，先完成预测校准；不构造虚假的联合概率');
 if(set&&(set.generationId!==f.generationId||set.businessId!==f.businessId||set.dataNature!==f.dataNature))throw Error('环境条件必须来自同企业、同资料性质与代次');
 const sales=enterpriseAsSales(f,basis),known=new Set(f.points.map(p=>p.entityId));
 for(const l of levers){
  if(!known.has(l.entityId))throw Error('补货变量包含尚未估计的SKU');
  if(!state.inputs.some(r=>r.kind==='fulfillment_rule'&&r.entityId===l.entityId&&r.warehouseId===l.warehouseId&&r.businessDate<=state.asOf))throw Error('补货目的仓没有已保存的履约规则');
 }
 // Positive rank coupling is an explicit conservative assumption, not a fitted copula.
 const paths=[...f.samples].sort((a,b)=>a.reduce((n,p)=>n+p.value,0)-b.reduce((n,p)=>n+p.value,0));
 const factors=Array.from({length:32},(_,i)=>set?assumptionMultiplier(set,i):1).sort((a,b)=>a-b);
 const joint=paths.map((path,i)=>({...sales,points:path.map(p=>({...p,value:p.value*factors[i],evidenceIds:[]}))}));
 const spec={id:'base',name:'当前履约规则',demandBps:10000,actions:[] as ScenarioAction[]};
 const baseResults=joint.map(p=>calculateScenario(state,spec,f.generationId,p));
 if(baseResults.some(r=>r.status!=='calculated'))throw Error('库存、收入、费用或履约规则资料不足，不能求解行动');
 const base={margin:baseResults.map(r=>r.totals.contributionMarginCents!),fulfilled:baseResults.map(r=>r.totals.fulfilled!),requested:baseResults.map(r=>r.totals.requested!)};
 const groups=levers.map(l=>{
  const scoped={...state,inputs:state.inputs.filter(r=>r.entityId===l.entityId)},forecasts=joint.map(p=>({...p,points:p.points.filter(v=>v.entityId===l.entityId),series:p.series.filter(v=>v.entityId===l.entityId),unestimatedEntityIds:[]}));
  const existing=forecasts.map(p=>calculateScenario(scoped,spec,f.generationId,p));
  const options:PlannerOption[]=[{id:l.entityId+':0',quantity:0,cashCents:0,action:null,deltaMargin:Array(32).fill(0),deltaFulfilled:Array(32).fill(0)}];
  for(let q=l.minUnits||l.stepUnits;q<=l.maxUnits;q+=l.stepUnits){
   const action:ScenarioAction={kind:'arrival',entityId:l.entityId,warehouseId:l.warehouseId,date:plusDays(state.asOf,1),quantity:q,leadDays:l.leadDays,costCents:q*l.unitExtraExpenseCents+l.fixedExtraExpenseCents,confirmed:l.confirmed};
   const evaluated=forecasts.map(p=>calculateScenario(scoped,{...spec,actions:[action]},f.generationId,p));
   if(evaluated.some(r=>r.status!=='calculated'))throw Error('补货变量缺少可计算的履约条件');
   const cashCents=q*l.unitCashCostCents+l.fixedCashCostCents;
   if(!integer(cashCents)||!integer(action.costCents))throw Error('补货金额超过数值预算');
   options.push({id:l.entityId+':'+q,quantity:q,cashCents,action,deltaMargin:evaluated.map((r,i)=>r.totals.contributionMarginCents!-existing[i].totals.contributionMarginCents!),deltaFulfilled:evaluated.map((r,i)=>r.totals.fulfilled!-existing[i].totals.fulfilled!)});
  }
  return {id:l.entityId,options};
 });
 return {version:OPERATING_PLANNER_VERSION,businessId:f.businessId,dataNature:f.dataNature,generationId:f.generationId,forecastJobId,assumptionSetId:set?.id??null,mission,base,groups,
  environment:{method:'joint_residual_windows_and_future_judgment',sampleCount:32,independentCalibrationBlocks:f.interval.calibrationBlocks,coupling:'shared_positive_rank',assumptionSetId:set?.id??null,notice:'整窗残差与未来条件按正向秩关联联合传播；分位数和频率仅描述这些条件样本，未通过联合概率校准'},
  coverage:{status:baseResults[0].coverage?.status??'partial',unestimatedEntityIds:baseResults[0].coverage?.unestimatedEntityIds??[]},
  limitations:['求解只覆盖声明的补货数量档与现有仓库履约顺序，不保证全企业或所有连续动作最优。','未来条件以显式销量比例进入模拟；尚未从价格、投放或供货环境学习因果响应。','补货现金占用只约束新增预算；商品成本已在历史单位贡献毛利内，额外费用只计未包含的支出。','依赖已录供给计划按期到货；没有供应商交期分布或履约容量模型。','环境判断与统计残差的秩关联是声明假设，需要真实资料检验。',...(baseResults[0].coverage?.status==='partial'?['未估计SKU不参与目标与服务水平，不代表全企业覆盖。']:[]),...(!mission.confirmed||levers.some(l=>!l.confirmed)?['经营或供货条件尚未确认；结果只能作为行动草案。']:[])]};
}
