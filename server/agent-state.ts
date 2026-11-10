import {gzipSync,gunzipSync,strToU8,strFromU8} from 'fflate/browser';
import type {AgentResult,RunBudget,RunObservation} from './agent-contracts.ts';
import {assert} from './errors.ts';
export function validatedBudget(value:unknown):RunBudget|undefined{
 if(value===undefined||value===null)return undefined;
 assert(typeof value==='object'&&!Array.isArray(value),422,'BUDGET','分析上限须为对象');
 const lifecycle:Record<string,number>={maxAttempts:3,timeoutSeconds:1800},usage=new Set(['maxModelCalls','maxTokens','maxToolCalls','maxMarketSearches','completionTokens']);
 for(const [k,v] of Object.entries(value))assert((k in lifecycle||usage.has(k))&&(v===null&&usage.has(k)||typeof v==='number'&&Number.isFinite(v)&&(k==='maxMarketSearches'?v>=0:v>0)&&(k in lifecycle?v<=lifecycle[k]:Number.isSafeInteger(v))&&(k==='timeoutSeconds'||Number.isInteger(v))),422,'BUDGET','运行参数字段或范围无效');
 return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))) as RunBudget;
}
export type StoredAgentResult=Partial<AgentResult>&{runtime?:RunObservation;__observationOnly?:boolean;__evidenceStorageVersion?:string;__evidenceTexts?:string[]};
const GZIP_METADATA=new Set(['claims','toolReads','marketEvidence']);
function packLargeMetadata(v:unknown,key=''):unknown{
 if(GZIP_METADATA.has(key)){
  const bytes=strToU8(JSON.stringify(v));
  if(bytes.length>65536){const zipped=gzipSync(bytes,{level:6});let binary='';for(let i=0;i<zipped.length;i+=8192)binary+=String.fromCharCode(...zipped.subarray(i,i+8192));return {__neoGzipJsonV1:true,rawBytes:bytes.length,payload:btoa(binary)};}
 }
 return Array.isArray(v)?v.map(x=>packLargeMetadata(x)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,packLargeMetadata(x,k)])):v;
}
function unpackLargeMetadata(v:unknown,key=''):unknown{
 if(GZIP_METADATA.has(key)&&v&&typeof v==='object'&&!Array.isArray(v)&&Object.hasOwn(v,'__neoGzipJsonV1')){
  const packed=v as {__neoGzipJsonV1:boolean;rawBytes:number;payload:string};
  assert(packed.__neoGzipJsonV1===true&&Number.isSafeInteger(packed.rawBytes)&&packed.rawBytes>0&&packed.rawBytes<=16*1024*1024&&typeof packed.payload==='string',503,'AGENT_RESULT_STORAGE','完整分析元数据存储编码无效');
  try{const binary=atob(packed.payload),zipped=Uint8Array.from(binary,c=>c.charCodeAt(0));assert(zipped.length>=18&&new DataView(zipped.buffer,zipped.byteOffset+zipped.length-4,4).getUint32(0,true)===packed.rawBytes,503,'AGENT_RESULT_STORAGE','完整分析元数据大小不一致');return JSON.parse(strFromU8(gunzipSync(zipped,new Uint8Array(packed.rawBytes))));}
  catch{assert(false,503,'AGENT_RESULT_STORAGE','完整分析元数据无法完整回读');}
 }
 return Array.isArray(v)?v.map(x=>unpackLargeMetadata(x)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,unpackLargeMetadata(x,k)])):v;
}
// Repeated full reference text can exceed D1's per-row limit. Intern only
// metadata exact/quote strings; prose, IDs, runtime controls and all sources
// remain intact. Expansion is synchronous and precedes every publication gate.
function packEvidenceTexts(value:StoredAgentResult):StoredAgentResult{
 const counts=new Map<string,number>();
 const count=(v:unknown,key='')=>{if(typeof v==='string'&&['exact','quote'].includes(key)&&v.length>=512)counts.set(v,(counts.get(v)??0)+1);else if(Array.isArray(v))v.forEach(x=>count(x));else if(v&&typeof v==='object')Object.entries(v).forEach(([k,x])=>count(x,k));};
 count(value);const texts=[...counts].filter(([,n])=>n>1).map(([text])=>text);if(!texts.length)return value;
 const indices=new Map(texts.map((text,i)=>[text,i]));
 const pack=(v:unknown,key=''):unknown=>typeof v==='string'&&['exact','quote'].includes(key)&&indices.has(v)?{__evidenceTextRef:indices.get(v)}:Array.isArray(v)?v.map(x=>pack(x)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,pack(x,k)])):v;
 return {...pack(value) as StoredAgentResult,__evidenceStorageVersion:'text-table-v1',__evidenceTexts:texts};
}
function unpackEvidenceTexts(value:StoredAgentResult):StoredAgentResult{
 if(value.__evidenceStorageVersion===undefined)return value;
 assert(value.__evidenceStorageVersion==='text-table-v1'&&Array.isArray(value.__evidenceTexts)&&value.__evidenceTexts.every(x=>typeof x==='string'),503,'AGENT_RESULT_STORAGE','完整分析引用存储编码无效');
 const texts=value.__evidenceTexts;
 const unpack=(v:unknown,key=''):unknown=>{
  if(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===1&&Object.hasOwn(v,'__evidenceTextRef')&&['exact','quote'].includes(key)){
   const index=(v as {__evidenceTextRef:number}).__evidenceTextRef;
   assert(Number.isSafeInteger(index)&&index>=0&&index<texts.length,503,'AGENT_RESULT_STORAGE','完整分析引用索引无效');return texts[index];
  }
  return Array.isArray(v)?v.map(x=>unpack(x)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='__evidenceStorageVersion'&&k!=='__evidenceTexts').map(([k,x])=>[k,unpack(x,k)])):v;
 };
 return unpack(value) as StoredAgentResult;
}
/** New-runtime prose needs a verified assessment receipt. Legacy stored schemas remain readable. */
function publicationState(value:StoredAgentResult){
 const explicit=value.semanticValidation as {status?:string;version?:string}|undefined;
 const receipt=value.businessAssessment?.context?.semanticValidation as {status?:string;version?:string}|undefined;
 if(explicit?.status==='rejected'||explicit?.status==='pending')return explicit;
 if(receipt?.status==='verified'&&receipt.version==='semantic-support-v1')return receipt;
 if(value.businessAssessment&&!receipt)return {version:null,status:'legacy_unverified'};
 if(value.runtimePlan||explicit?.version==='semantic-support-v1'||receipt?.version==='semantic-support-v1')return {version:'semantic-support-v1',status:'pending'};
 return {version:null,status:'legacy_unverified'};
}
function publishable(value:StoredAgentResult):AgentResult{
 const semanticValidation=publicationState(value);
 if(['pending','rejected'].includes(semanticValidation.status??'')){
  const {finding,specialists,operatingReviews,businessAssessment,homeDecision,organization,priorityAction,projections,professional,joint,brief,market,...safe}=value;
  return {...safe,finding:null,specialists:{},operatingReviews:{},semanticValidation,partial:true,marketEvidence:value.marketEvidence??[]} as AgentResult;
 }
 const projections=value.businessAssessment?.version==='business-assessment-v1'?value.businessAssessment.projections:{};
 return {...value,...projections,semanticValidation,specialists:projections.specialists??value.specialists??{},marketEvidence:projections.marketEvidence??value.marketEvidence??[]} as AgentResult;
}
export function readStoredResult(raw:string|null):{result:AgentResult|null;observability?:RunObservation}{
 if(!raw)return {result:null};
 const value=unpackEvidenceTexts(unpackLargeMetadata(JSON.parse(raw)) as StoredAgentResult);
 const observability=value.runtime;
 if(value.__observationOnly)return {result:null,observability};
 return {result:publishable(value),observability};
}
export function storedObservation(result:AgentResult|null,observability?:RunObservation):StoredAgentResult|null{
 return result?packLargeMetadata(packEvidenceTexts({...result,...(observability?{runtime:observability}:{})})) as StoredAgentResult:observability?{__observationOnly:true,runtime:observability}:null;
}
export function mergeResult(previous:AgentResult|null,current:AgentResult|null|undefined):AgentResult|null{
 if(!current)return previous?publishable(previous):null;
 const status=publicationState(current);
 // A gate update is authoritative: never merge cleared draft prose back in.
 if(status.status!=='legacy_unverified'||current.businessAssessment)return publishable(current);
 return publishable({...previous,...current,partial:current.partial??false,finding:Object.hasOwn(current,'finding')?current.finding:previous?.finding??null,
  specialists:Object.hasOwn(current,'specialists')?current.specialists:previous?.specialists??{},
  operatingReviews:current.operatingReviews===undefined?previous?.operatingReviews:{...(previous?.operatingReviews as Record<string,unknown>??{}),...(current.operatingReviews as Record<string,unknown>??{})},
  marketEvidence:[...new Map([...(previous?.marketEvidence??[]),...(current.marketEvidence??[])].map(x=>[x.id,x])).values()]});
}
// Applies on persistence and readback. It repairs old mismatched references
// without rewriting immutable service results and is safe on repeated syncs.
export function scopeMarketReferences(value:AgentResult|null,runId:string):AgentResult|null{
 if(!value)return null;
 const result=structuredClone(value),prefix=runId+':',scoped=(id:string)=>id.startsWith(prefix)?id:prefix+id;
 const ids=new Map<string,string>();
 for(const e of result.marketEvidence??[]){const id=scoped(e.id);ids.set(e.id,id);ids.set(id,id);ids.set(id.slice(prefix.length),id);}
 const refs=(values:string[]|undefined)=>(values??[]).map(id=>ids.get(id)??id);
 for(const f of [result.finding,...Object.values(result.specialists??{})]){
  if(!f)continue;f.evidenceIds=refs(f.evidenceIds);
  if(f.businessReview)f.businessReview.evidenceIds=refs(f.businessReview.evidenceIds);
  for(const p of f.organization?.priorities??[])p.evidenceIds=refs(p.evidenceIds);
  const w=f.marketWorkbench;if(w){for(const entry of [w.judgment,...w.signals,...w.cells])entry.evidenceIds=refs(entry.evidenceIds);for(const source of w.sources)source.id=ids.get(source.id)??source.id;}
 }
 for(const r of Object.values(result.operatingReviews as Record<string,{evidenceIds?:string[];selectedSourceIds?:string[]}>??{})){r.evidenceIds=refs(r.evidenceIds);if(r.selectedSourceIds)r.selectedSourceIds=refs(r.selectedSourceIds);}
 const rewrite=(v:unknown):unknown=>typeof v==='string'?(ids.get(v)??[...ids].reduce((out,[id,mapped])=>out.startsWith(id+':paragraph:')?mapped+out.slice(id.length):out,v)):Array.isArray(v)?v.map(rewrite):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,rewrite(x)])):v;
 result.finding=rewrite(result.finding) as typeof result.finding;
 result.specialists=rewrite(result.specialists) as typeof result.specialists;
 if(result.businessAssessment)result.businessAssessment=rewrite(result.businessAssessment) as typeof result.businessAssessment;
 result.marketEvidence=[...new Map(result.marketEvidence.map(e=>[scoped(e.id),{...e,id:scoped(e.id),sourceEvidenceId:e.sourceEvidenceId??(e.id.startsWith(prefix)?e.id.slice(prefix.length):e.id)}])).values()];
 return result;
}
export function mergeSteps(previous:Array<{message:string;at:string}>,current:unknown):Array<{message:string;at:string}>{
 if(!Array.isArray(current))return previous;
 return [...new Map([...previous,...current].map(s=>[`${s.at}/${s.message}`,s])).values()];
}
