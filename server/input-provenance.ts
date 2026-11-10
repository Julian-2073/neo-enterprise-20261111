import type {Context} from './auth.ts';
import type {Snapshot} from './contracts.ts';
import {assert} from './errors.ts';
import {all} from './store.ts';

type InputFact={id:string;kind:string;sourceId?:string;source_id?:string;availableAt?:string;fact:Record<string,unknown>};
type FrozenInput={snapshot:Snapshot;facts:InputFact[];domain:Record<string,unknown>};

// Resolve only the cached IDs within the authorized immutable snapshot. Do not
// add later records or guess provenance from batch IDs / line numbers.
export async function inputProvenance<T extends FrozenInput>(ctx:Context,s:Snapshot,value:T){
 assert(value&&value.snapshot&&Array.isArray(value.facts),503,'INPUT_STORAGE','冻结经营输入无效');
 for(const key of ['id','businessId','dataNature','asOf','periodStart','periodEnd','productId','channel','knownAt'] as const)
  assert((value.snapshot[key]??null)===(s[key]??null),503,'INPUT_SCOPE','冻结经营输入范围与已保存快照不一致');
 const ids=value.facts.map(f=>f.id);
 assert(ids.length<=10000&&ids.every(id=>typeof id==='string'&&!!id)&&new Set(ids).size===ids.length,503,'INPUT_PROVENANCE','冻结记录集合无效');
 // Bound membership by the saved snapshot, rather than joining a large JSON ID
 // list into the provenance query. The latter caused an expensive D1 plan.
 const rows=ids.length?await all<{id:string;kind:string;source_id:string;available_at:string}>(ctx.db,`SELECT DISTINCT f.id,f.kind,f.source_id,b.committed_at available_at FROM evidence_records e JOIN evidence_facts ef ON ef.evidence_id=e.id JOIN business_facts f ON f.id=ef.fact_id JOIN ingestion_batches b ON b.id=f.batch_id JOIN data_sources ds ON ds.id=f.source_id AND ds.business_id=f.business_id WHERE e.business_id=? AND e.snapshot_id=? AND f.business_id=? AND f.data_nature=? AND b.status='committed' AND b.committed_at<=? AND f.kind IN ('events','orders','inventory','expenses') LIMIT 10001`,ctx.businessId,s.id,ctx.businessId,s.dataNature,s.knownAt??s.generatedAt):[];
 assert(rows.length<=10000,503,'INPUT_PROVENANCE','冻结快照的来源集合超过上限');
 const byId=new Map(rows.map(r=>[r.id,r]));
 assert(ids.every(id=>byId.has(id)),503,'INPUT_PROVENANCE','冻结记录来源不能在当前企业和快照内核实');
 return {...value,facts:value.facts.map(f=>{
  const row=byId.get(f.id)!;
  assert(row.kind===f.kind&&!!row.source_id,503,'INPUT_PROVENANCE','冻结记录类型或来源无效');
  assert((f.sourceId==null||f.sourceId===row.source_id)&&(f.source_id==null||f.source_id===row.source_id),503,'INPUT_PROVENANCE','缓存来源与实际记录冲突');
  assert(f.availableAt==null||f.availableAt===row.available_at,503,'INPUT_PROVENANCE','缓存可用时间与实际提交时间冲突');
  return {...f,sourceId:row.source_id,availableAt:row.available_at};
 })};
}
