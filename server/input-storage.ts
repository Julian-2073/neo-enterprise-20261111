import {assert,ApiError} from './errors.ts';

const ROW_LIMIT=1_900_000;
const RAW_LIMIT=16*1024*1024;
const FORMAT='neo-inputs-gzip-v1';
const encoder=new TextEncoder();

// Lossless storage encoding only. Callers still receive the original envelope.
export async function encodeInput(value:unknown):Promise<string>{
 const raw=JSON.stringify(value),bytes=encoder.encode(raw);
 assert(bytes.length<=RAW_LIMIT,413,'INPUT_LIMIT','完整经营输入超过16MiB上限，请缩小范围');
 if(bytes.length<ROW_LIMIT)return raw;
 const zipped=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 let binary='';for(let i=0;i<zipped.length;i+=8192)binary+=String.fromCharCode(...zipped.subarray(i,i+8192));
 const packed=JSON.stringify({storageFormat:FORMAT,rawBytes:bytes.length,payload:btoa(binary)});
 assert(encoder.encode(packed).length<ROW_LIMIT,413,'INPUT_LIMIT','完整经营输入压缩后仍超过存储上限，请缩小范围');
 return packed;
}

export async function decodeInput(payload:string){
 try{
  const value=JSON.parse(payload);
  if(value.storageFormat==null)return value;
  assert(value.storageFormat===FORMAT,503,'INPUT_STORAGE','经营输入存储编码不支持');
  assert(Number.isSafeInteger(value.rawBytes)&&value.rawBytes>0&&value.rawBytes<=RAW_LIMIT&&typeof value.payload==='string',503,'INPUT_STORAGE','经营输入存储内容无效');
  const binary=atob(value.payload),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value:part}=await reader.read();if(done)break;size+=part.length;assert(size<=value.rawBytes,503,'INPUT_STORAGE','经营输入存储大小不一致');chunks.push(part);}}finally{await reader.cancel();}
  assert(size===value.rawBytes,503,'INPUT_STORAGE','经营输入存储大小不一致');
  const raw=new Uint8Array(size);let offset=0;for(const part of chunks){raw.set(part,offset);offset+=part.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 }catch(e){if(e instanceof ApiError)throw e;throw new ApiError(503,'INPUT_STORAGE','经营输入存储内容无法回读');}
}
