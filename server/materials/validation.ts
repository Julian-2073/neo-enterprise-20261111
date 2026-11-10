import Papa from 'papaparse';
import type {Context} from '../auth.ts';
import type {Fact,Issue,PreparedRow,StoredFact,Batch} from '../contracts.ts';
import {hash,parseTime,dateOnly} from '../csv.ts';
import {all} from '../store.ts';
import {assert} from '../errors.ts';
import {isMaterialKind,type MaterialKind,type MaterialRow} from './contracts.ts';
import {materialTemplates,materialIdField} from './templates.ts';

export function selectMaterial(rows:MaterialRow[],kind:MaterialKind,id:string,day:string):MaterialRow|undefined {
 // A later effective version supersedes the earlier one, including an explicit expired version.
 const eligible=rows.filter(r=>r.kind===kind && r.fact.object_id===id && r.fact.effective_from!<=day)
  .sort((a,b)=>b.fact.effective_from!.localeCompare(a.fact.effective_from!)||b.availableAt.localeCompare(a.availableAt)||a.id.localeCompare(b.id));
 const r=eligible[0];return r&&(!r.fact.effective_to||day<r.fact.effective_to)?r:undefined;
}
export async function readMaterials(ctx:Context,nature:string,knownAt:string):Promise<MaterialRow[]>{
 const rows=await all<StoredFact&{committed_at:string}>(ctx.db,`SELECT f.*,b.committed_at FROM business_facts f JOIN ingestion_batches b ON b.id=f.batch_id
 WHERE f.business_id=? AND f.data_nature=? AND b.status='committed' AND b.committed_at<=? AND f.kind IN ('roles','products','skus','channels','warehouses','customers','customer_identities','arrivals','supply_rules') ORDER BY f.id LIMIT 10001`,ctx.businessId,nature,knownAt);
 return rows.map(r=>({...r,kind:r.kind as MaterialKind,fact:JSON.parse(r.payload) as Fact,availableAt:r.committed_at}));
}
export async function parseMaterials(csv:string,kind:MaterialKind,start:string,end:string){
 const parsed=Papa.parse<string[]>(csv,{skipEmptyLines:'greedy'}),headers=(parsed.data[0]??[]).map(s=>s.trim()),config=materialTemplates[kind];
 const issues:Issue[]=parsed.errors.map(e=>({row:(e.row??0)+1,field:'',code:e.code,message:e.message,severity:'error'})),rows:PreparedRow[]=[];
 const error=(row:number,field:string,message:string)=>issues.push({row,field,message,code:'MATERIAL_VALIDATION',severity:'error'});
 if(!parsed.data.slice(1).length)error(1,'','至少需要一条资料');
 if(new Set(headers).size!==headers.length)error(1,'','重复表头');
 for(const k of config.required)if(!headers.includes(k))error(1,k,'缺少必填列');
 for(const k of headers)if(![...config.required,...config.optional].includes(k))error(1,k,'未知列');
 if(issues.length)return {rows,issues,rowCount:Math.max(0,parsed.data.length-1)};
 for(let i=1;i<parsed.data.length;i++){
  const row=i+1,cells=parsed.data[i],before=issues.length;
  if(cells.length!==headers.length){error(row,'','字段数量不一致');continue;}
  const value=Object.fromEntries(headers.map((k,j)=>[k,cells[j].trim()]));
  for(const k of config.required)if(!value[k]&&!(kind==='supply_rules'&&k==='minimum_sellable_units'&&value.qualification_basis==='inventory_safety_units'))error(row,k,'不能为空');
  for(const [k,v] of Object.entries(value))if(v.length>200)error(row,k,'最多200字符');
  let from='',to:string|null=null;
  try{from=dateOnly(value.effective_from);if(value.effective_to)to=dateOnly(value.effective_to);if(to&&to<=from)throw Error('有效止日必须晚于起日');if(from<start||from>end)throw Error('有效起日不在声明覆盖期');}catch(e){error(row,'effective_from',String(e));}
  const objectId=kind==='customer_identities'?JSON.stringify([value.identity_namespace,value.external_id]):value[materialIdField[kind]];
  const f:Fact={source_record_id:value.source_record_id,object_id:objectId,effective_from:from,effective_to:to,occurred_at:from?parseTime(from):'',business_date:from,product_id:null,sku_id:null,channel:null};
  for(const k of config.required.concat(config.optional).filter(k=>!['source_record_id','effective_from','effective_to'].includes(k))) {
   if(['received_units','source_version','source_known_at','source_status','qualification_basis'].includes(k)&&!headers.includes(k))continue;
   if(['units','safety_units','minimum_sellable_units','target_ratio_bps','received_units','source_version'].includes(k)){
    const v=value[k];if(!v){(f as Record<string,unknown>)[k]=null;continue;}
    if(!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))||(k==='target_ratio_bps'&&Number(v)>10000)){error(row,k,'须为非负安全整数；比例最多10000基点');continue;}
    (f as Record<string,unknown>)[k]=Number(v);
   }else (f as Record<string,unknown>)[k]=value[k]||null;
  }
  if(kind==='channels')f.channel=value.channel_id;
  if(kind==='customers')f.customer_id=objectId;
  if(kind==='arrivals'){
   try{f.eta=dateOnly(value.eta);}catch(e){error(row,'eta',String(e));}
   if(!['planned','rescheduled','partially_received','received','cancelled'].includes(value.status))error(row,'status','到货状态无效');
   if(f.received_units!=null){if(f.received_units>f.units!)error(row,'received_units','累计收货不能超过计划量');if(f.status==='received'&&f.received_units!==f.units)error(row,'received_units','完整收货须等于计划量');if(['planned','rescheduled'].includes(f.status!)&&f.received_units!==0)error(row,'status','有收货记录不能标为尚未收货');}
   if(f.status==='partially_received'&&!(f.received_units!=null&&f.received_units>0&&f.received_units<f.units!))error(row,'received_units','部分收货须有大于0且小于计划量的累计收货');
   if(f.source_version!=null&&f.source_version<1)error(row,'source_version','源版本须大于0');
  }
  if(f.source_known_at){try{if(!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(f.source_known_at))throw Error('源知悉时间须带时区');f.source_known_at=parseTime(f.source_known_at);}catch(e){error(row,'source_known_at',String(e));}}
  if(kind==='supply_rules'&&value.qualification_basis&&!['minimum_sellable_units','inventory_safety_units'].includes(value.qualification_basis))error(row,'qualification_basis','供给依据无效');
  if(f.unit&&f.unit!=='件')error(row,'unit','本轮数量单位固定为件，不进行隐式换算');
  if(f.image_url&&!/^https:\/\//.test(f.image_url))error(row,'image_url','仅保存https图片来源；不代为抓取');
  if(before===issues.length)rows.push({row,recordKey:JSON.stringify([kind,objectId,from]),contentHash:await hash(JSON.stringify(f)),fact:f});
 }
 return {rows,issues,rowCount:parsed.data.length-1};
}
export function canonicalCustomer(f:Fact,masters:MaterialRow[],day=f.business_date):string|null {
 if(f.identity_namespace&&f.external_contact_id){const alias=selectMaterial(masters,'customer_identities',JSON.stringify([f.identity_namespace,f.external_contact_id]),day);return alias?.fact.customer_id??null;}
 return f.contact_id??null;
}
export async function checkReferences(ctx:Context,batch:Pick<Batch,'kind'|'data_nature'|'source_id'> & {template_version?:string},rows:PreparedRow[]) {
 const strict=isMaterialKind(batch.kind)||batch.template_version==='2';if(!strict)return [];
 const masters=await readMaterials(ctx,batch.data_nature,new Date().toISOString());
 assert(masters.length<=10000,413,'MATERIAL_LIMIT','资料版本超过本轮10000条上限');
 const issues:Issue[]=[];const fail=(r:PreparedRow,field:string,message:string)=>issues.push({row:r.row,field,code:'REFERENCE_INVALID',message,severity:'error' as const});
 // Objects can reference other rows of the same material batch. Other kinds must commit first.
 for(const r of rows)if(isMaterialKind(batch.kind))masters.push({id:`staged:${r.row}`,kind:batch.kind,fact:r.fact,availableAt:'9999',batch_id:'staged',row_number:r.row,source_id:batch.source_id,record_key:r.recordKey,content_hash:r.contentHash,payload:JSON.stringify(r.fact)});
 const parent=(r:PreparedRow,k:MaterialKind,id:string|null|undefined,field:string)=>{
  if(!id)return undefined;const found=selectMaterial(masters,k,id,r.fact.business_date);if(!found)fail(r,field,`缺少同企业/性质、该业务日期有效的${k}：${id}`);return found;
 };
 const paid=(rows.some(r=>r.fact.linked_order_id)||batch.kind==='orders')?await all<StoredFact>(ctx.db,"SELECT * FROM business_facts WHERE business_id=? AND data_nature=? AND source_id=? AND kind='orders' AND json_extract(payload,'$.entry_type')='paid'",ctx.businessId,batch.data_nature,batch.source_id):[];
 for(const r of rows){const f=r.fact;
  if(isMaterialKind(batch.kind)){
   if(batch.kind==='products')parent(r,'roles',f.role_id,'role_id');
   if(batch.kind==='skus'){parent(r,'products',f.product_id,'product_id');parent(r,'roles',f.role_id,'role_id');}
   if(batch.kind==='customer_identities')parent(r,'customers',f.customer_id,'customer_id');
   if(batch.kind==='arrivals'){parent(r,'skus',f.sku_id,'sku_id');parent(r,'warehouses',f.warehouse_id,'warehouse_id');}
   if(batch.kind==='supply_rules'){parent(r,'roles',f.role_id,'role_id');if(masters.some(m=>m.kind==='supply_rules'&&m.fact.role_id===f.role_id&&m.fact.object_id!==f.object_id))fail(r,'rule_id','每个角色使用一个稳定规则ID；修订增加同ID有效版本');}
  }else{
   parent(r,'products',f.product_id,'product_id');const sku=parent(r,'skus',f.sku_id,'sku_id');
   if(sku&&sku.fact.product_id!==f.product_id)fail(r,'sku_id','SKU不属于此商品');
   parent(r,'channels',f.channel,'channel');parent(r,'warehouses',f.warehouse_id,'warehouse_id');
   if(!!f.identity_namespace!==!!f.external_contact_id)fail(r,'external_contact_id','身份命名空间与外部客户ID须同时提供');
   if(f.identity_namespace&&f.external_contact_id){const alias=parent(r,'customer_identities',JSON.stringify([f.identity_namespace,f.external_contact_id]),'external_contact_id');if(f.contact_id&&alias?.fact.customer_id!==f.contact_id)fail(r,'contact_id','客户主键与外部身份映射冲突');}
   const customer=canonicalCustomer(f,masters);if(f.contact_id||f.external_contact_id){if(!customer)fail(r,'contact_id','客户身份不可解析');else parent(r,'customers',customer,'contact_id');}
   if(batch.kind==='orders'&&f.entry_type==='refund'){const original=[...paid.map(p=>JSON.parse(p.payload) as Fact),...rows.map(p=>p.fact)].find(p=>p.entry_type==='paid'&&p.order_id===f.order_id&&p.order_line_id===f.order_line_id);if(original&&(canonicalCustomer(original,masters)||customer)&&canonicalCustomer(original,masters)!==customer)fail(r,'contact_id','退款客户与原支付客户不一致');}
   if(f.linked_order_line_id&&!f.linked_order_id)fail(r,'linked_order_id','订单行关联必须携带订单ID');
   if(f.linked_order_id){const matches=paid.map(p=>JSON.parse(p.payload) as Fact).filter(p=>p.order_id===f.linked_order_id&&(!f.linked_order_line_id||p.order_line_id===f.linked_order_line_id));if(!matches.length)fail(r,'linked_order_id','关联订单须在同来源内先提交支付事实');
    if(matches.some(p=>p.channel!==f.channel||f.product_id&&p.product_id!==f.product_id||customer&&canonicalCustomer(p,masters)!==customer))fail(r,'linked_order_id','事件和订单的客户/商品/渠道不一致');}
  }
 }
 return issues;
}
