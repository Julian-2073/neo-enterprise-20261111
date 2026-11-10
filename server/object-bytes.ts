import {assert} from './errors.ts';
export async function boundedObjectBytes(object:{arrayBuffer():Promise<ArrayBuffer>;size?:number;body?:ReadableStream<Uint8Array>},expected:number,maxBytes:number){
 assert(Number.isSafeInteger(expected)&&expected>=0&&expected<=maxBytes,503,'STORAGE_BUDGET','存储引用超出已支持的字节预算');
 if(object.size!==undefined)assert(object.size===expected&&object.size<=maxBytes,503,'STORAGE_SIZE','经营资料大小不一致');
 if(!object.body){const bytes=new Uint8Array(await object.arrayBuffer());assert(bytes.length===expected,503,'STORAGE_SIZE','经营资料大小不一致');return bytes;}
 const chunks:Uint8Array[]=[],reader=object.body.getReader();let total=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;assert(total<=expected&&total<=maxBytes,503,'STORAGE_SIZE','经营资料大小不一致');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 assert(total===expected,503,'STORAGE_SIZE','经营资料大小不一致');const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
