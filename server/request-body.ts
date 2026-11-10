import {assert} from './errors.ts';
export async function boundedRequestBytes(request:Request,maxBytes:number){
 assert(Number(request.headers.get('content-length')??0)<=maxBytes,413,'BODY_TOO_LARGE','请求内容过长');
 const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let total=0;
 if(reader)try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;assert(total<=maxBytes,413,'BODY_TOO_LARGE','请求内容过长');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
