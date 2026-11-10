import {assert} from './errors.ts';
import type {DecisionRecord} from './agent-contracts.ts';
// Shared by direct decisions and pinned Ontology actions. This stores a plan,
// not execution or observed financial outcomes.
export function decisionPlan(input:unknown):DecisionRecord['plan']{
 if(input==null)return null;
 assert(typeof input==='object'&&!Array.isArray(input),422,'DECISION_PLAN','草案格式无效');
 const p=input as Record<string,unknown>;
 const text=(x:unknown,max:number)=>{assert(typeof x==='string'&&x.trim().length>0&&x.trim().length<=max,422,'DECISION_PLAN','草案内容为空或过长');return x.trim();};
 const date=p.dueDate;
 assert(date==null||typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date,422,'DECISION_PLAN','观察日期无效');
 assert(Array.isArray(p.observationMetrics)&&p.observationMetrics.length<=12&&Array.isArray(p.steps)&&p.steps.length<=20,422,'DECISION_PLAN','观察指标或步骤无效');
 return {owner:p.owner==null?null:text(p.owner,100),dueDate:date as string|null??null,observationMetrics:p.observationMetrics.map(x=>text(x,100)),steps:p.steps.map(x=>text(x,500))};
}
