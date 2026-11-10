import type {Context} from './auth.ts';
import type {BusinessInput,BusinessProfile} from '../lib/business-state.ts';
import {validateBusinessLedger} from '../lib/business-ledger.ts';
import {currentRegisteredInput} from './business-input-visibility.ts';
import {legacyOperatingInputs} from './business-legacy-adapter.ts';
import {all,first,statement} from './store.ts';
import {ApiError} from './errors.ts';

// Read the epoch before reading the ledger. The batch increments it only if
// unchanged. A NOT NULL failure rolls the entire D1 batch back on contention.
export async function publicationEpoch(ctx:Context,nature:string){
 await statement(ctx.db,'INSERT OR IGNORE INTO neo_business_publications(business_id,data_nature,epoch) VALUES(?,?,0)',ctx.businessId,nature).run();
 return (await first<{epoch:number}>(ctx.db,'SELECT epoch FROM neo_business_publications WHERE business_id=? AND data_nature=?',ctx.businessId,nature))!.epoch;
}
export function guardPublication(ctx:Context,nature:string,epoch:number){
 return statement(ctx.db,'UPDATE neo_business_publications SET epoch=CASE WHEN epoch=? THEN epoch+1 ELSE NULL END WHERE business_id=? AND data_nature=?',epoch,ctx.businessId,nature);
}
export async function validatePublishedLedger(ctx:Context,nature:string,profile:BusinessProfile,now:string,sourceId:string,replacements:BusinessInput[],replaceCanonical=true){
 const rows=await all<{payload:string;source_id:string;record_key:string}>(ctx.db,`SELECT i.* FROM neo_business_inputs i WHERE i.business_id=? AND i.data_nature=? AND i.kind IN ('order','hotel_stay') AND ${currentRegisteredInput('i')}`,ctx.businessId,nature,now,now,now,now);
 const ledger=new Map<string,BusinessInput&{sourceId:string}>();
 for(const r of await legacyOperatingInputs(ctx,nature,now,'9999-12-31',profile))if(['order','hotel_stay'].includes(r.kind))ledger.set(JSON.stringify([r.sourceId,r.recordKey]),r);
 if(!replaceCanonical)for(const r of replacements)ledger.set(JSON.stringify([sourceId,r.recordKey]),{...r,sourceId});
 for(const r of rows)ledger.set(JSON.stringify([r.source_id,r.record_key]),{...JSON.parse(r.payload),sourceId:r.source_id});
 if(replaceCanonical)for(const r of replacements)ledger.set(JSON.stringify([sourceId,r.recordKey]),{...r,sourceId});
 try{validateBusinessLedger([...ledger.values()]);}catch(e){throw new ApiError(422,'BUSINESS_LEDGER',(e as Error).message);}
}
