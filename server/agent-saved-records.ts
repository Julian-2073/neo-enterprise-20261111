import type {ScenarioSpec,ScenarioResult} from '../lib/business-scenarios.ts';
import type {Context} from './auth.ts';
import {all} from './store.ts';
import {assert} from './errors.ts';
import {hash} from './csv.ts';
import {loadBusinessArtifact} from './business-artifact-storage.ts';
export type RecordFilter={cursor?:number;limit?:number;kind?:string;id?:string};
export function recordPage<T extends {kind?:string;id?:string}>(records:T[],filter:RecordFilter={}){
 const cursor=filter.cursor??0,limit=filter.limit??20;
 assert(Number.isSafeInteger(cursor)&&cursor>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=100,422,'RECORD_PAGE','分页游标或大小无效');
 assert(!filter.kind||['business_decision','business_scenario_bundle'].includes(filter.kind),422,'RECORD_FILTER','记录类型无效');
 const matching=records.filter(r=>(!filter.kind||r.kind===filter.kind)&&(!filter.id||r.id===filter.id));
 return {records:matching.slice(cursor,cursor+limit),total:matching.length,cursor,limit,hasMore:cursor+limit<matching.length,nextCursor:cursor+limit<matching.length?cursor+limit:null,filters:{kind:filter.kind??null,id:filter.id??null}};
}
type SavedRecord=Record<string,unknown>&{id:string;kind?:string;generationId:string;scenario?:ScenarioSpec;forecast?:ScenarioResult;scenarios?:ScenarioSpec[];results?:ScenarioResult[]};
export async function frozenSavedRecordRegistry(ctx:Context,nature:string,generationId:string){
 const rows=await all<{kind:string;payload:string}>(ctx.db,"SELECT kind,payload FROM neo_artifacts WHERE business_id=? AND data_nature=? AND snapshot_id=? AND kind IN ('business_decision','business_scenario_bundle') ORDER BY created_at DESC,id DESC",ctx.businessId,nature,generationId);
 const fullRecords:SavedRecord[]=[];
 for(const row of rows){
  const v=await loadBusinessArtifact(ctx,nature,row.kind,row.payload) as SavedRecord;
  assert(v.generationId===generationId,503,'ARTIFACT_SCOPE','保存记录经营代次不符');
  fullRecords.push({...v,kind:row.kind,contentHash:await hash(JSON.stringify(v))});
 }
 const records=fullRecords.map(v=>({id:v.id,kind:v.kind,generationId:v.generationId,createdAt:v.createdAt,version:v.version??null,status:v.status??'saved_scenario_bundle',title:v.title??null,reasonExcerpt:typeof v.reason==='string'?v.reason.slice(0,200):null,reasonTruncated:typeof v.reason==='string'&&v.reason.length>200,bundleId:v.bundleId??null,scenarioId:v.scenario?.id??null,scenarioName:v.scenario?.name??null,scenarios:(v.scenarios??[]).map((r:Record<string,unknown>)=>({id:r.id,name:r.name})),contentHash:v.contentHash}));
 return {businessId:ctx.businessId,dataNature:nature,generationId,...recordPage(records,{limit:6}),fullRecords,truncated:records.length>6,registryHash:await hash(JSON.stringify(fullRecords)),limitations:['目录分页不代表全部记录；read_saved_records按cursor/filter读取，typed=true取得原冻结参数与计算结果。保存选择不代表执行。']};
}
