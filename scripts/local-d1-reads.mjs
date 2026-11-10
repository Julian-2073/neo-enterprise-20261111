// Miniflare reads cross a local HTTP proxy. A lost SELECT response is safe to
// read again; mutations and batch receipts must never be replayed here.
function transportFailure(error){
 for(let depth=0;error&&depth<4;depth++,error=error.cause){
  if(/fetch failed|ECONNRESET|ECONNREFUSED|UND_ERR_SOCKET|other side closed/i.test(String(error.message??error.code??error)))return true;
 }
 return false;
}
export function recoverLocalReads(database,{onRetry=()=>console.warn('NEO local storage: retrying an interrupted read')}={}){
 const wrap=(statement,sql)=>new Proxy(statement,{get(target,key){
  if(key==='bind')return (...values)=>wrap(target.bind(...values),sql);
  if(['all','first','raw'].includes(key)&&/^\s*SELECT\b/i.test(sql))return async(...args)=>{
   try{return await target[key](...args);}catch(error){
    if(!transportFailure(error))throw error;
    onRetry();await new Promise(resolve=>setTimeout(resolve,100));
    return target[key](...args);
   }
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 return new Proxy(database,{get(target,key){
  if(key==='prepare')return sql=>wrap(target.prepare(sql),sql);
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
}
