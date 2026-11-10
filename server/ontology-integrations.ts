import {assert,json} from './errors.ts';
import type {Context} from './auth.ts';
import {all,first} from './store.ts';
import {activeControl,credential,insert} from './control-plane.ts';
import {definition} from './ontology/store.ts';
async function service(ctx:Context,path:string,body?:unknown){
 const base=ctx.runtime.NEO_AGENT_URL,token=ctx.runtime.NEO_SERVICE_TOKEN;
 assert(base&&token,503,'INTEGRATION_SERVICE','开源适配执行服务尚未连接');
 let r:Response;try{r=await fetch(base+'/ontology-integrations/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(path==='ontogpt/extract'?190000:150000)});}catch{assert(false,502,'INTEGRATION','开源服务暂不可连接，未修改经营数据');}
 const d=await r.json() as Record<string,unknown>;assert(r.ok,r.status,'INTEGRATION',typeof d.detail==='string'?d.detail:'开源服务返回异常');return d;
}
export async function integrationRead(ctx:Context,n:string,id?:string){
 if(id){const r=await first<{id:string;payload:string;created_at:string}>(ctx.db,"SELECT id,payload,created_at FROM neo_control_resources WHERE id=? AND business_id=? AND data_nature=? AND kind IN ('catalog-sync','extraction')",id,ctx.businessId,n);assert(r,404,'NOT_FOUND','接入记录不在当前范围');return json({id:r.id,createdAt:r.created_at,...JSON.parse(r.payload)});}
 const records=await all(ctx.db,"SELECT id,kind,created_at,json_extract(payload,'$.status') status,json_extract(payload,'$.definitionId') definitionId FROM neo_control_resources WHERE business_id=? AND data_nature=? AND kind IN ('catalog-sync','extraction') ORDER BY created_at DESC LIMIT 30",ctx.businessId,n);
 try{return json({...await service(ctx,'health'),records});}catch(e){return json({records,serviceError:e instanceof Error?e.message:'服务连接异常',openmetadata:{connected:false},ontogpt:{installed:false,localModels:[]}});}
}
export async function integrationWrite(ctx:Context,n:string,id:string,op:string,input:Record<string,unknown>){
 const d=await definition(ctx);
 if(id==='openmetadata'&&op==='sync'){
   const result=await service(ctx,'openmetadata/sync',{businessId:ctx.businessId,dataNature:n,definition:d});
   const ident=await insert(ctx,n,'catalog-sync',{...result,definitionId:d.version});return json({id:ident,...result},201);
 }
 if(id==='ontogpt'&&op==='extract'){
   assert(typeof input.text==='string'&&input.text.trim()&&input.text.length<=8000,422,'TEXT','填写 1 至 8,000 字的企业资料');
   const target=d.types.find(t=>t.id===input.typeId);assert(target&&target.importable!==false,422,'TYPE','选择已发布的可导入对象类型');
   let model:string,baseUrl:string,apiKey='';let profileId:string|null=null;
   if(input.mode==='local'){
     assert(typeof input.model==='string'&&/^[a-zA-Z0-9._:/-]{1,120}$/.test(input.model),422,'MODEL','选择本地模型');
     const h=await service(ctx,'health') as {ontogpt:{localModels:string[]}};assert(h.ontogpt.localModels.includes(input.model),422,'MODEL','本地模型未安装');model='ollama/'+input.model;baseUrl='http://127.0.0.1:11434';
   }else{
     assert(input.mode==='active',422,'MODEL','选择本地模型或中台已启用模型');const active=await activeControl(ctx,n,'model');assert(active,409,'MODEL','先在中台启用模型连接');const c=await credential(ctx,n,active.id);profileId=active.id;model='openai/'+c.model;baseUrl=c.baseUrl;apiKey=c.apiKey;
   }
   const result=await service(ctx,'ontogpt/extract',{text:input.text,target,model,baseUrl,apiKey});
   const payload={...result,typeId:target.id,definitionId:d.version,modelProfileId:profileId};const ident=await insert(ctx,n,'extraction',payload);return json({id:ident,...payload},201);
 }
 return json({error:{code:'NOT_FOUND',message:'开源接入操作不存在'}},404);
}
