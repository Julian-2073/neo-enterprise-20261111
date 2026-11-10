import {salesForecastSummary} from '../lib/business-forecast.ts';
import {boundedObjectBytes} from './object-bytes.ts';
import type {Context} from './auth.ts';
import type {OperatingGeneration} from './business-generations.ts';
import {assert} from './errors.ts';
import {hash} from './csv.ts';
export function generationSummary(g:OperatingGeneration){return {...g,...(g.salesForecast?{salesForecast:salesForecastSummary(g.salesForecast)}:{}),state:{...g.state,inputCount:g.state.inputs.length,inputs:[],metrics:Object.fromEntries(Object.entries(g.state.metrics).map(([k,m])=>[k,{...m,evidenceCount:m.evidenceIds.length,evidenceIds:m.evidenceIds.slice(0,20)}]))},baseline:{...g.baseline,pointCount:g.baseline.points.length,points:[]}};}
export async function storeGeneration(ctx:Context,nature:string,g:OperatingGeneration){
 const raw=JSON.stringify(g),bytes=new TextEncoder().encode(raw);if(bytes.length<1000000)return raw;
 assert(bytes.length<=128*1024*1024,413,'GENERATION_SIZE','完整经营代次超过128MiB；请缩小资料窗口');assert(ctx.runtime.RAW_FILES,503,'GENERATION_STORAGE','完整经营资料存储不可用');
 const sha256=await hash(raw),objectKey=`generations/${ctx.businessId}/${nature}/${g.id}/${sha256}.json`;
 await ctx.runtime.RAW_FILES.put(objectKey,bytes);
 return JSON.stringify({storageFormat:'neo-generation-r2-v1',objectKey,sha256,rawBytes:bytes.length,summary:generationSummary(g)});
}
export async function loadGeneration(ctx:Context,nature:string,payload:string):Promise<OperatingGeneration>{
 const value=JSON.parse(payload);if(!value.storageFormat){assert(value.state?.businessId===ctx.businessId&&value.state?.dataNature===nature,503,'GENERATION_SCOPE','经营代次归属不符');return value;}
 assert(value.storageFormat==='neo-generation-r2-v1'&&typeof value.objectKey==='string'&&value.objectKey.startsWith(`generations/${ctx.businessId}/${nature}/${value.summary?.id}/`)&&ctx.runtime.RAW_FILES,503,'GENERATION_STORAGE','经营代次存储引用无效');
 const object=await ctx.runtime.RAW_FILES.get(value.objectKey);assert(object,503,'GENERATION_STORAGE','完整经营代次暂不可读取');const bytes=await boundedObjectBytes(object,value.rawBytes,128*1024*1024);assert(bytes.length===value.rawBytes,503,'GENERATION_STORAGE','经营代次大小不一致');const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);assert(await hash(raw)===value.sha256,503,'GENERATION_STORAGE','经营代次校验失败');const g=JSON.parse(raw);assert(g.id===value.summary.id&&g.state.businessId===ctx.businessId&&g.state.dataNature===nature,503,'GENERATION_SCOPE','经营代次归属不符');return g;
}
export function storedGenerationSummary(payload:string){const v=JSON.parse(payload);return v.storageFormat?v.summary:generationSummary(v);}
