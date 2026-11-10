import {all,type Runtime} from './store.ts';
import {synchronizeAgentRuns,BACKGROUND_AGENT_RUN_FILTER} from './agents.ts';
import {drainBusinessUpdates} from './business-generations.ts';
// Durable local update worker. Reviews are dispatched only for enterprises
// with server-authorized automatic patrol; isolated/manual delivery stays off.
// Round-robin batches keep one tenant from monopolizing refresh work.
export async function runBusinessUpdateCycle(runtime:Runtime,lastTenant='',tenantLimit=5,stopped=()=>false){
 if(!runtime.DB)return lastTenant;
 const tenants=await all<{business_id:string;data_nature:string;name:string}>(runtime.DB,`SELECT t.business_id,t.data_nature,b.name FROM (SELECT business_id,data_nature,created_at work_at FROM neo_business_updates WHERE (status='pending' OR status='running' AND lease_until<?) AND attempts<5 UNION ALL SELECT business_id,data_nature,updated_at work_at FROM neo_runs WHERE ${BACKGROUND_AGENT_RUN_FILTER}) t JOIN businesses b ON b.id=t.business_id GROUP BY t.business_id,t.data_nature ORDER BY MIN(t.work_at),t.business_id,t.data_nature`,new Date().toISOString());
 const tenantKey=(t:{business_id:string;data_nature:string})=>t.business_id+'\0'+t.data_nature;
 const sorted=[...tenants].sort((a,b)=>tenantKey(a).localeCompare(tenantKey(b))),after=sorted.filter(t=>tenantKey(t)>lastTenant),before=sorted.filter(t=>tenantKey(t)<=lastTenant);
 for(const tenant of (lastTenant?[...after,...before]:tenants).slice(0,Math.min(5,Math.max(1,tenantLimit)))){if(stopped())break;const ctx={db:runtime.DB,runtime,userId:'computation-worker',businessId:tenant.business_id,businessName:tenant.name,role:'admin' as const};await drainBusinessUpdates(ctx,tenant.data_nature,1);await synchronizeAgentRuns(ctx,tenant.data_nature);lastTenant=tenantKey(tenant);}
 return lastTenant;
}
export function startBusinessUpdatePump(runtime:Runtime,intervalMs=2000){
 let stopped=false,running=false,lastTenant='';
 const tick=async()=>{
  if(stopped||running)return;running=true;
  try{lastTenant=await runBusinessUpdateCycle(runtime,lastTenant,5,()=>stopped);}finally{running=false;}
 };
 const timer=setInterval(()=>{void tick().catch(()=>{/* persisted event remains retryable */});},intervalMs);
 return {tick,async stop(){stopped=true;clearInterval(timer);while(running)await new Promise(resolve=>setTimeout(resolve,10));}};
}
