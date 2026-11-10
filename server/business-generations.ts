import {forecastManifest} from './business-forecast.ts';
import {forecastSales,FORECAST_VERSION,type SalesForecast} from '../lib/business-forecast.ts';
import {currentBusinessGeneration} from './business-head.ts';
import {registeredInputVisibility} from './business-input-visibility.ts';
import {legacyOperatingCoverage} from './business-legacy-adapter.ts';
import {businessProfile} from './business-state.ts';
import {agentPolicy} from './agent-policy.ts';
import {operatingReviews} from './business-reviews.ts';
import {storeGeneration} from './generation-storage.ts';
import type {Context} from './auth.ts';
import {all,first,statement} from './store.ts';
import {readBusinessState} from './business-state.ts';
import {hash} from './csv.ts';
import {activePlatformSettings} from './platform-settings.ts';
import {METRIC_VERSION} from '../lib/business-metrics.ts';
import {calculateScenario,SCENARIO_VERSION,type ScenarioResult} from '../lib/business-scenarios.ts';
import type {BusinessState} from '../lib/business-state.ts';

export const GENERATION_VERSION='operating-generation-v1.3';
export type OperatingGeneration={version:string;id:string;sourceKey:string;state:BusinessState;configuration:unknown;baseline:ScenarioResult;salesForecast?:SalesForecast;steps:Array<{name:string;status:'completed'|'pending'|'blocked';dependencies:string[];reason?:string}>;createdAt:string;};
type Update={id:string;cause:string;resource_id:string;created_at:string;attempts:number};
// Persisted leases survive HTTP/worker restarts. A conditional claim prevents two
// workers publishing an update concurrently; immutable generation keys dedupe retries.
export async function drainBusinessUpdates(ctx:Context,nature:string,limit=5){
 const now=new Date().toISOString();
 const events=await all<Update>(ctx.db,"SELECT * FROM neo_business_updates WHERE business_id=? AND data_nature=? AND (status='pending' OR status='running' AND lease_until<?) AND attempts<5 ORDER BY created_at,id LIMIT ?",ctx.businessId,nature,now,Math.min(10,Math.max(1,limit)));
 const results:Array<{updateId:string;generationId?:string;status:string}>=[];
 for(const event of events){
  const leaseUntil=new Date(Date.now()+120000).toISOString();
  const claim=await statement(ctx.db,"UPDATE neo_business_updates SET status='running',lease_until=?,attempts=attempts+1,last_error=NULL WHERE id=? AND business_id=? AND data_nature=? AND (status='pending' OR status='running' AND lease_until<?) AND attempts<5",leaseUntil,event.id,ctx.businessId,nature,now).run();
  if(!claim.meta.changes)continue;
  try{
   if(event.cause==='review'){
    if(agentPolicy(ctx.runtime,ctx.businessId).automaticPatrolAllowed&&!await first(ctx.db,'SELECT id FROM neo_monitor_subscriptions WHERE business_id=? AND data_nature=? AND enabled=1',ctx.businessId,nature)){
     const latest=await currentBusinessGeneration(ctx,nature);
     if(latest?.id===event.resource_id)await operatingReviews(ctx,nature,event.resource_id,true);
    }
    await statement(ctx.db,"UPDATE neo_business_updates SET status='completed',lease_until=NULL,last_error=NULL WHERE id=? AND status='running' AND lease_until=?",event.id,leaseUntil).run();
    results.push({updateId:event.id,generationId:event.resource_id,status:'completed'});continue;
   }
   const imports=await all<{payload:string}>(ctx.db,'SELECT payload FROM neo_business_imports WHERE business_id=? AND data_nature=? AND created_at<=?',ctx.businessId,nature,event.created_at);
   const profile=await businessProfile(ctx,nature,event.created_at);
   const legacyCoverage=profile?await legacyOperatingCoverage(ctx,nature,event.created_at,JSON.parse(profile.payload)):[];
   const coverage=[...legacyCoverage,...imports.flatMap(r=>JSON.parse(r.payload).coverage as Array<{kind:string;start:string;end:string}>)].filter(c=>['order','expense','hotel_stay','event'].includes(c.kind));
   const end=coverage.length?coverage.map(c=>c.end).sort().at(-1):undefined;
   const earliest=coverage.length?coverage.map(c=>c.start).sort()[0]:undefined;
   const configuration=await activePlatformSettings(ctx,nature,event.created_at);
   const windowStart=end?new Date(Date.parse(end)-(configuration.settings.statisticsWeeks*7-1)*86400000).toISOString().slice(0,10):undefined;
   const start=earliest&&windowStart?(earliest>windowStart?earliest:windowStart):earliest;
   // Future bookings, planned arrivals and capacity must never advance the
   // inventory observation clock. Only actual stock known at this event can.
   const inventory=await first<{business_date:string}>(ctx.db,`SELECT MAX(i.business_date) business_date FROM neo_business_inputs i WHERE i.business_id=? AND i.data_nature=? AND i.kind IN ('inventory','material_inventory') AND i.known_at<=? AND i.business_date<=? AND ${registeredInputVisibility('i')}`,ctx.businessId,nature,event.created_at,new Intl.DateTimeFormat('en-CA',{timeZone:profile?JSON.parse(profile.payload).timezone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(event.created_at)),event.created_at);
   const asOf=inventory?.business_date&&(!end||inventory.business_date>end)?inventory.business_date:end;
   const state=await readBusinessState(ctx,nature,{knownAt:event.created_at,asOf,start,end});
   const issuedAt=new Date().toISOString(),manifest=state.profile.industry==='ecommerce'?await forecastManifest(ctx,nature,state):null,salesForecast=manifest?forecastSales(state,manifest,issuedAt):undefined;
   const forecastManifestHash=manifest?await hash(JSON.stringify(manifest)):null;
   const sourceKey=await hash(JSON.stringify({version:GENERATION_VERSION,forecastVersion:FORECAST_VERSION,forecastManifestHash,metricsVersion:METRIC_VERSION,scenarioVersion:SCENARIO_VERSION,profile:state.profileVersion,configuration,period:state.period,asOf:state.asOf,inputs:state.inputs.map(r=>[r.id,r.revision,r.customerId??null,r.identityEvidenceIds??[]]),coverage:state.coverage}));
   const id='generation-'+sourceKey;
   const baseline=calculateScenario(state,{id:'baseline',name:'维持现状',demandBps:10000,actions:[]},id,salesForecast);
   const payload:OperatingGeneration={version:GENERATION_VERSION,id,sourceKey,state,configuration,baseline,...(salesForecast?{salesForecast}:{}),steps:[
    {name:'reconciliation',status:'completed',dependencies:[]},
    {name:'metrics',status:'completed',dependencies:['reconciliation']},
    {name:'forecast',status:baseline.status==='calculated'?'completed':'blocked',dependencies:['metrics'],reason:baseline.status==='calculated'?undefined:'约束或财务资料不足'},
    {name:'specialist-reviews',status:'pending',dependencies:['metrics']},
    {name:'joint-review',status:'pending',dependencies:['forecast','specialist-reviews']},
    {name:'page-projection',status:'pending',dependencies:['joint-review']},
   ],createdAt:new Date().toISOString()};
   const reviewEventId='auto-review-'+sourceKey;
   const stored=await storeGeneration(ctx,nature,payload),publishedAt=new Date().toISOString();
   const leaseSQL="EXISTS(SELECT 1 FROM neo_business_updates WHERE id=? AND business_id=? AND data_nature=? AND status='running' AND lease_until=? AND lease_until>?)";
   const leaseArgs=[event.id,ctx.businessId,nature,leaseUntil,publishedAt];
   const writes=await ctx.db.batch([
    statement(ctx.db,`INSERT OR IGNORE INTO neo_business_generations(id,business_id,data_nature,source_key,status,payload,created_at,updated_at) SELECT ?,?,?,?,'calculated',?,?,? WHERE ${leaseSQL}`,id,ctx.businessId,nature,sourceKey,stored,payload.createdAt,payload.createdAt,...leaseArgs),
    statement(ctx.db,`INSERT INTO neo_business_heads(business_id,data_nature,generation_id,event_at,event_id) SELECT ?,?,?,?,? WHERE ${leaseSQL} ON CONFLICT(business_id,data_nature) DO UPDATE SET generation_id=excluded.generation_id,event_at=excluded.event_at,event_id=excluded.event_id WHERE (excluded.event_at,excluded.event_id)>(neo_business_heads.event_at,neo_business_heads.event_id)`,ctx.businessId,nature,id,event.created_at,event.id,...leaseArgs),
    statement(ctx.db,`INSERT OR IGNORE INTO audit_events(id,business_id,actor_id,action,resource_id,created_at) SELECT ?,?,?,'business_head_advanced',?,? WHERE ${leaseSQL} AND EXISTS(SELECT 1 FROM neo_business_heads WHERE business_id=? AND data_nature=? AND generation_id=? AND event_id=?)`,'business-head:'+event.id,ctx.businessId,ctx.userId,id,publishedAt,...leaseArgs,ctx.businessId,nature,id,event.id),
    ...(agentPolicy(ctx.runtime,ctx.businessId).automaticPatrolAllowed&&!await first(ctx.db,'SELECT id FROM neo_monitor_subscriptions WHERE business_id=? AND data_nature=? AND enabled=1',ctx.businessId,nature)?[statement(ctx.db,`INSERT OR IGNORE INTO neo_business_updates(id,business_id,data_nature,cause,resource_id,status,created_at) SELECT ?,?,?,'review',?,'pending',? WHERE ${leaseSQL} AND EXISTS(SELECT 1 FROM neo_business_heads WHERE business_id=? AND data_nature=? AND generation_id=?)`,reviewEventId,ctx.businessId,nature,id,payload.createdAt,...leaseArgs,ctx.businessId,nature,id)]:[]),
    statement(ctx.db,"UPDATE neo_business_updates SET status='completed',lease_until=NULL,last_error=NULL WHERE id=? AND status='running' AND lease_until=? AND lease_until>?",event.id,leaseUntil,publishedAt),
   ]);
   results.push({updateId:event.id,...(writes.at(-1)?.meta.changes?{generationId:id,status:'completed'}:{status:'lease_lost'})});
  }catch(e){
   // Keep a bounded error code rather than raw DB/provider text or credentials.
   const code=(e as {code?:string}).code??'COMPUTATION_FAILED';
   await statement(ctx.db,"UPDATE neo_business_updates SET status='failed',lease_until=NULL,last_error=? WHERE id=? AND status='running' AND lease_until=?",code,event.id,leaseUntil).run();
   results.push({updateId:event.id,status:'failed'});
  }
 }
 return results;
}
export async function retryBusinessUpdate(ctx:Context,nature:string,id:string){
 const result=await statement(ctx.db,"UPDATE neo_business_updates SET status='pending',attempts=0,last_error=NULL,lease_until=NULL WHERE id=? AND business_id=? AND data_nature=? AND status='failed'",id,ctx.businessId,nature).run();
 return Boolean(result.meta.changes);
}
