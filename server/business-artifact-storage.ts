import {boundedObjectBytes} from './object-bytes.ts';
import type {Context} from './auth.ts';
import {assert} from './errors.ts';
import {hash} from './csv.ts';
export type OperatingArtifact={id:string;businessId:string;dataNature:string;results?:Array<{points:unknown[];[key:string]:unknown}>;forecast?:{points:unknown[];[key:string]:unknown};[key:string]:unknown};
export function artifactSummary(value:OperatingArtifact){const operating=value.operating as {points:unknown[]}|undefined;const dataset=value.dataset as {current?:{series:unknown[]};windows?:unknown[]}|undefined;return {...value,...(Array.isArray(operating?.points)?{operating:{...operating,pointCount:operating.points.length,points:[]}}:{}),...(dataset?{dataset:{seriesCount:dataset.current?.series.length,windowCount:dataset.windows?.length}}:{}),...(value.results?{results:value.results.map(r=>({...r,pointCount:r.points.length,points:[]}))}:{}),...(value.forecast?{forecast:{...value.forecast,pointCount:value.forecast.points.length,points:[],...('samples' in value.forecast?{samples:[]}: {})}}:{})};}
export async function storeBusinessArtifact(ctx:Context,nature:string,kind:string,value:OperatingArtifact){
 const raw=JSON.stringify(value),bytes=new TextEncoder().encode(raw);if(bytes.length<1000000)return raw;
 assert(bytes.length<=128*1024*1024&&ctx.runtime.RAW_FILES,413,'ARTIFACT_STORAGE','方案明细超过本地支持范围或存储未连接');
 const sha256=await hash(raw),objectKey=`business-artifacts/${ctx.businessId}/${nature}/${kind}/${value.id}/${sha256}.json`;
 await ctx.runtime.RAW_FILES.put(objectKey,bytes);return JSON.stringify({storageFormat:'neo-artifact-r2-v1',kind,id:value.id,objectKey,sha256,rawBytes:bytes.length,summary:artifactSummary(value)});
}
export async function loadBusinessArtifact<T=OperatingArtifact>(ctx:Context,nature:string,kind:string,payload:string):Promise<T>{
 const value=JSON.parse(payload);let result=value;
 if(value.storageFormat){assert(value.storageFormat==='neo-artifact-r2-v1'&&value.kind===kind&&typeof value.objectKey==='string'&&value.objectKey.startsWith(`business-artifacts/${ctx.businessId}/${nature}/${kind}/${value.id}/`)&&ctx.runtime.RAW_FILES,503,'ARTIFACT_STORAGE','方案资料引用不符');const object=await ctx.runtime.RAW_FILES.get(value.objectKey);assert(object,503,'ARTIFACT_STORAGE','方案明细不可读取');const bytes=await boundedObjectBytes(object,value.rawBytes,128*1024*1024);assert(bytes.length===value.rawBytes,503,'ARTIFACT_STORAGE','方案明细大小不一致');const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);assert(await hash(raw)===value.sha256,503,'ARTIFACT_STORAGE','方案明细校验失败');result=JSON.parse(raw);assert(result.id===value.id,503,'ARTIFACT_SCOPE','方案标识不符');}
 assert(result.businessId===ctx.businessId&&result.dataNature===nature,503,'ARTIFACT_SCOPE','方案归属不符');return result;
}
export function businessArtifactSummary(payload:string){const value=JSON.parse(payload);return value.storageFormat?value.summary:artifactSummary(value);}
