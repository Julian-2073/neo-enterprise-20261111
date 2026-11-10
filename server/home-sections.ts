import {knowledgeFreshness} from './knowledge.ts';
import type {Context} from './auth.ts';
import type {Snapshot} from './contracts.ts';
import type {CustomerJourney} from './customer-journey.ts';
import {first} from './store.ts';
import {readStoredResult} from './agent-state.ts';
import {customerJourneyChart} from '../lib/customer-journey-chart.ts';
import {savedNeoData,neoCalculations} from '../lib/operating-demo-data.ts';
import type {ModelMarketWorkbench} from './market-review.ts';
import type {AgentRun} from './agent-contracts.ts';
import {completeAssessmentRow,rowAssessment,rowConfigurationFreshness} from './business-assessment.ts';

// A completed specialist review, scoped to the immutable input, is the only
// source of AI copy. Chat replies and partial/failed runs cannot replace it.
export async function specialistReview(ctx:Context,s:Snapshot,mode:'conversion'|'supply'){
 const shared=await completeAssessmentRow(ctx,s),assessment=rowAssessment(shared);
 if(shared&&assessment){const review=assessment.businessAssessment?.projections.professional?.[mode];return review?{...review,runId:shared.id}:null;}
 const row=await first<{id:string;result:string|null;payload:string}>(ctx.db,"SELECT id,result,payload FROM neo_runs WHERE business_id=? AND snapshot_id=? AND data_nature=? AND status='completed' AND json_extract(payload,'$.purpose')='review' AND json_extract(payload,'$.mode')=? ORDER BY created_at DESC,rowid DESC LIMIT 1",ctx.businessId,s.id,s.dataNature,mode);
 const review=row&&(await rowConfigurationFreshness(ctx,s.dataNature,row)).status==='current'&&(await knowledgeFreshness(ctx,s.dataNature,row.id)).status==='current'?readStoredResult(row.result).result?.finding?.businessReview:null;
 return review?{...review,runId:row!.id}:null;
}
export function supplyOverview(s:Snapshot,review:Awaited<ReturnType<typeof specialistReview>>){
 const rows=s.data.inventory;
 const sum=(key:'sellable_units'|'in_transit_units')=>rows.length&&rows.every(r=>r[key]!=null)?rows.reduce((n,r)=>n+r[key]!,0):null;
 const calculated=neoCalculations(savedNeoData(s),true,s);
 return {display:undefined as {title:string;unit:string;metricLabel:string;secondaryLabel:string;secondaryValue:number|null;max:number}|undefined,snapshotId:s.id,businessId:s.businessId,dataNature:s.dataNature,asOf:s.asOf,review,
  metrics:{sellableUnits:sum('sellable_units'),inTransitUnits:sum('in_transit_units'),emptyLocations:rows.length?rows.filter(r=>r.sellable_units===0).length:null},
  evidenceId:s.evidenceIds.inventoryCostCents??null,labels:calculated.weeks,series:calculated.supplySeries,
  weeks:s.data.weeks.map(w=>({start:w.start,evidenceId:`${s.id}:view:supply-pulse:${w.start}`})),
  note:s.data.materials?.supply.ruleStatus==='configured'?'按已保存备货规则计算；目标仍需业务确认。':'备货规则不足，补齐后自动计算供给达标率。'};
}
export function homeSections(s:Snapshot,people:{journey:CustomerJourney;review:Awaited<ReturnType<typeof specialistReview>>},goods:ReturnType<typeof supplyOverview>,market:ModelMarketWorkbench&{run:AgentRun|null;canGenerate:boolean}){
 const j=people.journey,current=j.recent??j.period,previous=j.recent?j.previous:null;
 return {version:'home-sections-v1',businessId:s.businessId,dataNature:s.dataNature,snapshotId:s.id,
  people:{...people,series:customerJourneyChart(j),labels:j.weekly.map(w=>`${w.start.slice(5)}–${w.end.slice(5)}`),period:{start:current.start,end:current.end,comparable:!!j.recent},
   metrics:{purchasingCustomers:current.counts.A4,previousPurchasingCustomers:previous?.counts.A4??null,conversionRate:current.transitions.find(x=>x.from==='A3')?.rate??null,previousConversionRate:previous?.transitions.find(x=>x.from==='A3')?.rate??null},
   evidenceId:j.evidenceId,weeks:j.weekly.map(w=>({start:w.start,evidenceId:`${s.id}:view:customer-pulse:${w.start}`}))},
  goods,market:{judgment:market.modelReview?market.judgment:null,periods:market.periods,roles:market.roles,channels:market.channels.map(c=>({channel:c.channel,name:c.name})),
   cells:market.cells.map(c=>({channel:c.channel,role:c.role,headline:c.headline,status:c.status,evidenceId:c.evidenceId,metrics:c.displayMetrics.slice(0,2)})),
   sources:market.sources.map(x=>({id:x.id,evidenceId:x.evidenceId,summary:x.summary,publisher:x.publisher,publishedAt:x.publishedAt,retrievedAt:x.retrievedAt,timing:x.timing})),
   run:market.run,canGenerate:market.canGenerate,evidenceId:`${s.id}:view:market-efficiency`}};
}
export type HomeSections=ReturnType<typeof homeSections>;
export type SupplyOverview=ReturnType<typeof supplyOverview>;
