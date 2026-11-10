import type {Context} from './auth.ts';
import {first} from './store.ts';
// Old generations predate the head table. Their frozen knowledge clock, never
// their recomputation time, is the compatibility fallback.
export const generationOrder="COALESCE(json_extract(payload,'$.state.knownAt'),json_extract(payload,'$.summary.state.knownAt'),created_at) DESC,created_at DESC,id DESC";
export async function currentBusinessGeneration(ctx:Context,nature:string){
 return await first<{id:string;payload:string}>(ctx.db,'SELECT g.id,g.payload FROM neo_business_heads h JOIN neo_business_generations g ON g.id=h.generation_id AND g.business_id=h.business_id AND g.data_nature=h.data_nature WHERE h.business_id=? AND h.data_nature=?',ctx.businessId,nature)
  ??await first<{id:string;payload:string}>(ctx.db,`SELECT id,payload FROM neo_business_generations WHERE business_id=? AND data_nature=? ORDER BY ${generationOrder} LIMIT 1`,ctx.businessId,nature);
}
