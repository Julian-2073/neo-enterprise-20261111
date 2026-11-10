import {knowledgeFreshness} from './knowledge.ts';
import type {Context} from './auth.ts';
import type {Snapshot} from './contracts.ts';
import type {MarketEvidence,MarketWorkbenchReview} from './agent-contracts.ts';
import {all,first} from './store.ts';
import {readStoredResult} from './agent-state.ts';
import {type MarketWorkbench} from './market-workbench.ts';
import {completeAssessmentRow,rowAssessment,rowConfigurationFreshness} from './business-assessment.ts';
export const MARKET_REVIEW_VERSION='market-workbench-model-v1';
export async function marketCandidates(ctx:Context,s:Snapshot,selectedIds:string[]=[]){
 const rows=await all<{payload:string}>(ctx.db,'SELECT m.payload FROM neo_market_evidence m JOIN neo_runs r ON r.id=m.run_id AND r.business_id=m.business_id AND r.snapshot_id=m.snapshot_id WHERE m.business_id=? AND m.snapshot_id=? AND r.data_nature=? ORDER BY m.created_at DESC,m.id DESC LIMIT 12',ctx.businessId,s.id,s.dataNature);
 const selected=selectedIds.length?await all<{payload:string}>(ctx.db,'SELECT m.payload FROM neo_market_evidence m JOIN neo_runs r ON r.id=m.run_id AND r.business_id=m.business_id AND r.snapshot_id=m.snapshot_id WHERE m.business_id=? AND m.snapshot_id=? AND r.data_nature=? AND m.id IN (SELECT value FROM json_each(?))',ctx.businessId,s.id,s.dataNature,JSON.stringify(selectedIds)):[];
 return [...new Map([...rows,...selected].map(r=>{const value=JSON.parse(r.payload) as MarketEvidence;return [value.id,value] as const;})).values()];
}
export async function savedMarketReview(ctx:Context,s:Snapshot){
 const shared=await completeAssessmentRow(ctx,s),assessment=rowAssessment(shared);
 if(shared&&assessment){
  const p=assessment.businessAssessment!.projections,market=p.specialists?.market,professional=p.professional?.market;
  const review=p.market??(professional?{judgment:professional,signals:[],cells:[],sources:[],nextStep:market?.candidates[0]??'核对市场资料缺口'}:null);
  return {row:shared,review,model:assessment.model??null};
 }
 const row=await first<{id:string;status:string;result:string|null;payload:string}>(ctx.db,"SELECT * FROM neo_runs WHERE business_id=? AND snapshot_id=? AND data_nature=? AND request_id LIKE 'market-workbench-model-v1:%' ORDER BY created_at DESC,rowid DESC LIMIT 1",ctx.businessId,s.id,s.dataNature);
 const eligibility=row?await rowConfigurationFreshness(ctx,s.dataNature,row):null;const fresh=row?await knowledgeFreshness(ctx,s.dataNature,row.id):null;
 const result=eligibility?.status==='current'&&fresh?.status==='current'&&row?readStoredResult(row.result).result:null;
 return {row,review:row?.status==='completed'?result?.finding?.marketWorkbench??null:null,model:result?.model??null};
}
export function marketModelBasis(base:MarketWorkbench,candidates:MarketEvidence[],s:Snapshot){
 const projection=(c:MarketWorkbench['cells'][number]|MarketWorkbench['channels'][number])=>({channel:c.channel,role:c.role,evidenceId:c.evidenceId,current:c.current,previous:c.previous,changes:c.changes});
 return {version:MARKET_REVIEW_VERSION,periods:base.periods,signalEvidenceIds:{demand:`${s.id}:view:market-demand`,efficiency:`${s.id}:view:market-efficiency`},signals:base.signals.map(({id,name,value,delta,note,evidenceId})=>({id,name,value,delta,note,evidenceId})),roles:base.roles,channels:base.channels.map(c=>({...projection(c),name:c.name})),cells:base.cells.map(c=>({...projection(c),roleName:c.roleName})),spends:base.spends,unallocatedSpendCents:base.unallocatedSpendCents,unallocatedRoleSpendCents:base.channels.map(channel=>({channel:channel.channel,amountCents:channel.current.spendCents==null?null:channel.current.spendCents-base.cells.filter(c=>c.channel===channel.channel).reduce((n,c)=>n+(c.current.spendCents??0),0)})),sourceCandidates:candidates.map(({sourceEvidenceId,...c})=>{void sourceEvidenceId;return {...c,content:(c.content??c.excerpt??'').slice(0,1500),excerpt:(c.excerpt??'').slice(0,500),modelExcerptLimit:1500,modelExcerptIsPartial:(c.content??'').length>1500};}),evidenceIds:[...Object.values(s.evidenceIds),...base.cells.map(c=>c.evidenceId),...base.channels.map(c=>c.evidenceId),...base.spends.map(c=>c.evidenceId),`${s.id}:view:market-demand`,`${s.id}:view:market-efficiency`,...candidates.map(c=>c.id)],limitations:base.limitations};
}
// Only a completed model result supplies business copy and selects sources.
// Calculation labels are inputs, never presented as generated judgments.
export function marketDisplayMetrics(row:Pick<MarketWorkbench['cells'][number],'current'|'previous'|'changes'>){
 const definitions=[
  {id:'paidOrders',key:'paidOrders',label:'支付订单',unit:'笔'},
  {id:'netRevenue',key:'netRevenueCents',label:'净成交',unit:'元'},
  {id:'intent',key:'intent',label:'意向',unit:'次'},
  {id:'costPerOrder',key:'costPerOrderCents',label:'每单投放',unit:'元'},
 ] as const;
 return definitions.map(d=>{
  const value=row.current[d.key],previous=row.previous?.[d.key]??null,delta=row.changes[d.id];
  const format=(n:number|null)=>n==null?'—':(d.unit==='元'?n/100:n).toLocaleString('zh-CN',{maximumFractionDigits:2});
  const magnitude=delta==null?null:Math.abs(delta*100);
  const change=delta==null?'无对照':delta===0?'持平':`${delta>0?'+':'−'}${magnitude!<.1?'<0.1':magnitude!.toFixed(1)}%`;
  return {id:d.id,label:d.label,unit:d.unit,value:format(value),previousValue:format(previous),change,delta,
   direction:delta==null||delta===0?'neutral':(d.id==='costPerOrder'?delta<0:delta>0)?'positive':'negative'};
 });
}
export function modelMarketPresentation(base:MarketWorkbench,review:MarketWorkbenchReview|null,candidates:MarketEvidence[]){
 const chosen=new Map(review?.sources.filter(s=>s.selected).map(x=>[x.id,x])??[]);
 const sources=base.sources.filter(s=>chosen.has(s.id)).map(s=>({...s,...chosen.get(s.id)!}));
 const cells=base.cells.map(c=>{const result=review?.cells.find(x=>x.channel===c.channel&&x.role===c.role);return {...c,displayMetrics:marketDisplayMetrics(c),headline:result?.headline??'等待 AI 分析',summary:result?.summary??'经营数字已计算，等待市场智能体判断。',status:result?.status??'unavailable',modelEvidenceIds:result?.evidenceIds??[]};});
 const signals=base.signals.map(s=>{const result=review?.signals.find(x=>x.id===s.id),ref=result?.evidenceIds[0],source=sources.find(x=>x.id===ref);return {...s,title:result?.title??'等待 AI 分析',summary:result?.summary??'正在准备经营对比和原文依据。',value:s.id==='competition'?(review?`${sources.filter(x=>x.category==='competition').length} 条`:'—'):s.value,evidenceId:source?.evidenceId??ref??s.evidenceId,modelEvidenceIds:result?.evidenceIds??[]};});
 return {...base,judgment:review?.judgment??{title:'正在分析渠道与竞品',summary:'大模型正在筛选原文、分析经营变化，并整理下一步。'},signals,cells,sources,modelReview:review,sourceSelections:review?.sources??[],candidateCount:review?.sources.length??candidates.length};
}
export type ModelMarketWorkbench=ReturnType<typeof modelMarketPresentation>;
