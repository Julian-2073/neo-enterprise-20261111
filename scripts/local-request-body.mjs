export async function readIncomingBody(request,maxBytes=2*1024*1024){
 const tooLarge=()=>Object.assign(new Error('请求超过本地入口字节上限'),{status:413});
 if(Number(request.headers['content-length']??0)>maxBytes){request.resume();throw tooLarge();}
 return new Promise((resolve,reject)=>{
  let chunks=[],total=0,done=false;
  const fail=error=>{if(done)return;done=true;chunks=[];request.removeListener('data',data);request.resume();reject(error);};
  const data=chunk=>{total+=chunk.length;if(total>maxBytes)return fail(tooLarge());chunks.push(chunk);};
  request.on('data',data);request.once('error',fail);request.once('aborted',()=>fail(new Error('请求已中止')));
  request.once('end',()=>{request.removeListener('data',data);request.removeListener('error',fail);if(done)return;done=true;resolve(Buffer.concat(chunks,total));chunks=[];});
 });
}
