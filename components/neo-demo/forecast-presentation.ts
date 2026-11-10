import type {ForecastResult,ScenarioResult} from '../../server/agent-contracts';
import {scenarioBelongsToBaseline} from '../../lib/decision-history.ts';
export function coverageNote(value:ForecastResult){
 if(value.snapshotId?.startsWith('generation-')&&value.forecastCoverage?.status==='partial')return `仅估算有历史支付或入住记录的商品／房型；${value.forecastCoverage.unestimatedProductIds.length} 个实体需求未知，不是零。已知结转库存未扣减这些实体的未知需求；总毛利仅覆盖已估算范围，不能推荐全企业最优方案。单位为${value.unit}。`;
 if(value.snapshotId?.startsWith('generation-'))return `按完整性声明与实际登记的供给约束推演，单位为${value.unit}；未覆盖的资料不会当作零。`;
 const c=value.forecastCoverage;
 if(!c)return '这份历史记录未保存商品估算范围，覆盖情况待核；不能据此认定全部商品已估算。';
 if(c.status==='partial')return `仅估算部分商品：${c.unestimatedProductIds.length} 个商品、${c.unestimatedSkuIds.length} 个商品规格尚无可估算的销量历史，需求未知，不是零。已知库存和库存资金仍纳入；期末库存未扣减这些商品的未知需求。`;
 return '已估算有销售历史的商品规格；这是支付出库量的条件推演，不代表完整潜在需求。';
}
export function backtestNote(value:ForecastResult){
 if(value.salesForecast){const e=value.salesForecast.evaluation;return e.status==='no_paid_series'?'预测起点之前没有当时已录入且可用的支付销量序列，当前尚不能核验历史预测表现。':`本口径历史检验有效${e.folds.length}个窗口、跳过${e.skipped.length}个；WAPE为销量误差，不是准确率。当前仅发布预先确定的基线，区间尚未校准，真实发布后的效果待检验。`;}

 const b=value.backtest;
 if(b?.status==='evaluated'&&b.timeAware===true&&b.methodVersion==='asof-backtest-v2'&&b.timezone==='Asia/Shanghai'&&b.coverageBasis==='published_source_declaration'&&b.labelKnownAt&&b.skippedFolds?.length===0){
  return '按每个历史预测日上海经营日截止前已录入的资料训练，标签使用另行注明的资料截至时间；四周均值、上周和四周季节简单对照使用相同窗口。完整性依据来源发布声明，尚不是独立证明。WAPE 是预测误差，不是准确率；合成对照不代表真实预测效果。';
 }
 if(b?.status==='partially_evaluated')return '部分历史窗口因当时资料晚到、录入时间或覆盖待核而跳过；误差只覆盖有效窗口，不能认定完整历史回测通过。';
 if(b?.status==='historical_availability_unverified'||b?.status==='insufficient_coverage')return '历史资料的录入时间或当时完整覆盖待核，相关窗口已跳过；不能把缺少资料当成零销量，尚不能核验历史预测表现。';
 switch(value.backtestAvailability?.status==='no_paid_series'?'no_paid_series':value.backtest?.status){
  case 'evaluated':return '仅按经营发生时间回顾分窗误差；尚未核验每个历史预测窗当时实际可用的资料。WAPE 是预测误差，不是准确率；不能据此认定历史预测表现已通过验收。';
  case 'no_paid_series':return '预测起点之前没有当时已录入且可用的支付销量序列，当前尚不能核验历史预测表现。经营发生时间与资料录入时间不同；历史行数充足也不等于回测通过。';
  case 'insufficient_history':return '当时可用的销量历史不足十六周，尚不能进行四周窗回测。';
  case 'insufficient_folds':return '当时可用资料不足以形成有效的历史测试窗，尚不能核验历史预测表现。';
  default:return '历史预测表现尚未核验，请查看回测状态与资料缺口；不能把尚未核验理解为误差为零。';
 }
}
export function comparisonNotice(value:ForecastResult){return value.calculationVersion&&value.inputHash?'仅比较同一计算版本、输入资料和基线下的方案。':'这份历史记录缺少计算版本或输入摘要，仍可回看；可比性待核，请重新计算基线后再比较。';}
export function recommendScenario(baseline:ForecastResult|null,scenarios:ScenarioResult[]){
 if(!baseline)return null;
 const values=[baseline,...scenarios.filter(v=>scenarioBelongsToBaseline(v,baseline))].filter(v=>!v.feasibility||v.feasibility.status==='feasible');
 if(values.length<2||values.some(v=>(!v.feasibility&&!v.forecastCoverage)||v.forecastCoverage?.status==='partial'||!v.calculationVersion||!v.inputHash||v.totals.contributionMarginCents==null||v.totals.spendCents==null||v.totals.variableCostCents==null))return null;
 return [...values].sort((a,b)=>b.totals.contributionMarginCents!-a.totals.contributionMarginCents!||a.totals.unmetUnits-b.totals.unmetUnits||(a.totals.endingInventoryCostCents??Infinity)-(b.totals.endingInventoryCostCents??Infinity))[0];
}
