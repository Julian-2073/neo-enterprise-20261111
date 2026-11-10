import {assert,ApiError} from '../errors.ts';
import {parseTime} from '../csv.ts';
import {INPUT_KINDS,type InputKind} from '../../lib/business-state.ts';
import {propertyRule} from '../../lib/ontology-design.ts';
export type Scalar=string|number|boolean|null;
export type Property={type:'string'|'integer'|'number'|'boolean'|'date'|'datetime';required?:boolean;unit?:string;mode?:'source'|'computed'|'editable';conflict?:'source'|'override'|'review';name?:string;description?:string;format?:'text'|'number'|'money'|'date';min?:number;max?:number;enum?:Scalar[]};
export type ObjectType={id:string;name:string;primaryKey:string;title:string;properties:Record<string,Property>;mapping?:Record<string,{field:string;scale?:number}>;effectiveField?:string;planned?:boolean;importable?:boolean};
export type LinkType={id:string;name:string;from:string;to:string;property:string;cardinality:'many-to-one'|'one-to-one'|'many-to-many';outName?:string;inName?:string;description?:string;through?:{typeId:string;fromProperty:string;toProperty:string}};
export type Definition={version:string;types:ObjectType[];links:LinkType[];agentAccess?:Record<string,{roles:string[];properties:string[]}>};
export type Provenance={kind:string;id:string;batchId?:string;row?:number;availableAt:string;availability:'system_recorded';property?:string};
export type BusinessObject={typeId:string;id:string;title:string;properties:Record<string,Scalar>;provenance:Provenance[];referenceOnly:boolean};
export type BusinessLink={linkId:string;fromId:string;toId:string;provenance:Provenance[]};
export type QualityIssue={severity:'error'|'warning';code:string;message:string;typeId?:string;objectId?:string;row?:number;field?:string;sourceField?:string;constraintCode?:string};
export type ObjectQuery={typeId:string;filters?:Array<{property:string;op:'eq'|'in'|'gte'|'lte'|'isNull';value?:Scalar|Scalar[]}>;traverse?:{linkId:string;direction:'out'|'in'};aggregate?:{op:'count'|'sum';property?:string};cursor?:number;limit?:number;sort?:{property:string;direction:'asc'|'desc'}};
const txt=(required=false):Property=>({type:'string',required,mode:'source'});
const num=(unit?:string):Property=>({type:'number',unit,mode:'source'});
const editable=(type:Property['type'],unit?:string):Property=>({type,unit,mode:'editable',conflict:'review'});
const type=(id:string,name:string,properties:Record<string,Property>,title='id',extra:Partial<ObjectType>={}):ObjectType=>({id,name,primaryKey:'id',title,properties:{id:txt(true),...properties},...extra});
function neoLegacyDefinition():Definition{return {version:'neo-default-v1',types:[
 type('product','商品',{name:txt(),roleId:editable('string')},'name'),
 type('sku','SKU',{name:txt(),productId:txt(true),roleId:txt()},'name'),
 type('role','商品角色',{name:txt(),purpose:txt()},'name'),
 type('channel','渠道',{name:txt()},'name'),type('warehouse','仓库',{name:txt()},'name'),
 type('order','订单',{sourceId:txt(),channelId:txt()}),
 type('order_line','支付明细',{orderId:txt(true),productId:txt(true),skuId:txt(true),channelId:txt(),date:{type:'date'},quantity:num('件'),amountCents:num('分'),costCents:num('分')}),
 type('refund','退款',{orderLineId:txt(true),skuId:txt(),date:{type:'date'},quantity:num('件'),amountCents:num('分')}),
 type('event','经营事件',{productId:txt(),channelId:txt(),date:{type:'date'},eventType:txt(),quantity:num('次')}),
 type('expense','费用',{productId:txt(),channelId:txt(),date:{type:'date'},amountCents:num('分')}),
 type('inventory','库存观测',{productId:txt(),skuId:txt(true),warehouseId:txt(true),date:{type:'date'},sellableUnits:num('件'),inTransitUnits:num('件'),safetyUnits:editable('number','件'),inventoryCostCents:num('分')}),
 type('arrival','到货计划',{skuId:txt(true),warehouseId:txt(true),date:{type:'date',required:true},units:num('件')},'id',{planned:true}),
 type('forecast','预测运行',{snapshotId:txt(),units:{...num('件'),mode:'computed'},asOf:{type:'date'}},'id',{importable:false}),
 type('scenario','情景',{forecastId:txt(),snapshotId:txt(),units:{...num('件'),mode:'computed'}},'id',{importable:false}),
 type('decision','老板选择',{scenarioId:txt(),reason:txt(),actualOutcome:editable('string')},'id',{importable:false}),
 type('market_evidence','外部证据',{url:txt(),verificationStatus:txt(),historicalEligible:{type:'boolean'}},'id',{importable:false}),
 ],links:[
 ['sku_product','所属商品','sku','product','productId'],['sku_role','SKU角色','sku','role','roleId'],['product_role','所属角色','product','role','roleId'],
 ['line_order','所属订单','order_line','order','orderId'],['line_sku','购买SKU','order_line','sku','skuId'],
 ['order_channel','成交渠道','order','channel','channelId'],['refund_line','原支付明细','refund','order_line','orderLineId'],
 ['inventory_sku','库存SKU','inventory','sku','skuId'],['inventory_warehouse','所在仓库','inventory','warehouse','warehouseId'],
 ['arrival_sku','计划SKU','arrival','sku','skuId'],['arrival_warehouse','到货仓库','arrival','warehouse','warehouseId'],
 ['expense_channel','费用渠道','expense','channel','channelId'],['expense_product','费用商品','expense','product','productId'],
 ['event_product','事件商品','event','product','productId'],['event_channel','事件渠道','event','channel','channelId'],
 ['scenario_forecast','预测基线','scenario','forecast','forecastId'],['decision_scenario','选定方案','decision','scenario','scenarioId'],
 ].map(([id,name,from,to,property])=>({id,name,from,to,property,cardinality:'many-to-one'}))};}
export function neoDefinition(version='neo-default-v2'):Definition{if(version==='neo-default-v1')return neoLegacyDefinition();return {version:'neo-default-v2',types:[
 type('product','商品',{name:txt(),roleId:editable('string'),imageUrl:txt(),effectiveFrom:{type:'date'},effectiveTo:{type:'date'}},'name'),
 type('sku','SKU',{name:txt(),productId:txt(true),roleId:txt(),safetyUnits:num('件'),unit:txt()},'name'),
 type('role','商品角色',{name:txt(),purpose:txt()},'name'),
 type('channel','渠道',{name:txt()},'name'),type('warehouse','仓库',{name:txt()},'name'),
 type('customer','客户',{name:txt()},'name'),
 type('customer_identity','客户身份',{customerId:txt(true),identityNamespace:txt(),externalId:txt()}),
 type('supply_rule','供给规则',{roleId:txt(true),minimumSellableUnits:num('件'),targetRatio:num('比例')}),
 type('order','订单',{sourceId:txt(),channelId:txt(),customerId:txt()}),
 type('order_line','支付明细',{orderId:txt(true),customerId:txt(),productId:txt(true),skuId:txt(true),channelId:txt(),date:{type:'date'},quantity:num('件'),amountCents:num('分'),costCents:num('分')}),
 type('refund','退款',{orderLineId:txt(true),skuId:txt(),date:{type:'date'},quantity:num('件'),amountCents:num('分')}),
 type('event','经营事件',{productId:txt(),channelId:txt(),date:{type:'date'},eventType:txt(),quantity:num('次'),customerId:txt(),linkedOrderId:txt()}),
 type('expense','费用',{productId:txt(),channelId:txt(),date:{type:'date'},amountCents:num('分')}),
 type('inventory','库存观测',{productId:txt(),skuId:txt(true),warehouseId:txt(true),date:{type:'date'},sellableUnits:num('件'),inTransitUnits:num('件'),safetyUnits:editable('number','件'),inventoryCostCents:num('分')}),
 type('arrival','到货计划',{skuId:txt(true),warehouseId:txt(true),date:{type:'date',required:true},units:num('件'),status:txt()},'id',{planned:true}),
 type('forecast','预测运行',{snapshotId:txt(),units:{...num('件'),mode:'computed'},asOf:{type:'date'}},'id',{importable:false}),
 type('scenario','情景',{forecastId:txt(),snapshotId:txt(),units:{...num('件'),mode:'computed'}},'id',{importable:false}),
 type('decision','老板选择',{scenarioId:txt(),reason:txt(),actualOutcome:editable('string')},'id',{importable:false}),
 type('market_evidence','外部证据',{url:txt(),verificationStatus:txt(),historicalEligible:{type:'boolean'}},'id',{importable:false}),
 ],links:[
 ['identity_customer','身份客户','customer_identity','customer','customerId'],['event_customer','行为客户','event','customer','customerId'],['line_customer','支付客户','order_line','customer','customerId'],['event_order','行为订单','event','order','linkedOrderId'],['rule_role','规则角色','supply_rule','role','roleId'],
 ['sku_product','所属商品','sku','product','productId'],['sku_role','SKU角色','sku','role','roleId'],['product_role','所属角色','product','role','roleId'],
 ['line_order','所属订单','order_line','order','orderId'],['line_sku','购买SKU','order_line','sku','skuId'],
 ['order_channel','成交渠道','order','channel','channelId'],['refund_line','原支付明细','refund','order_line','orderLineId'],
 ['inventory_sku','库存SKU','inventory','sku','skuId'],['inventory_warehouse','所在仓库','inventory','warehouse','warehouseId'],
 ['arrival_sku','计划SKU','arrival','sku','skuId'],['arrival_warehouse','到货仓库','arrival','warehouse','warehouseId'],
 ['expense_channel','费用渠道','expense','channel','channelId'],['expense_product','费用商品','expense','product','productId'],
 ['event_product','事件商品','event','product','productId'],['event_channel','事件渠道','event','channel','channelId'],
 ['scenario_forecast','预测基线','scenario','forecast','forecastId'],['decision_scenario','选定方案','decision','scenario','scenarioId'],
 ].map(([id,name,from,to,property])=>({id,name,from,to,property,cardinality:'many-to-one'}))};}
const identifier=(x:unknown)=>typeof x==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(x);
export function validateDefinition(input:unknown):Definition{
 assert(input&&typeof input==='object',422,'INVALID_DEFINITION','需要类型定义');
 const d=input as Definition;assert(Array.isArray(d.types)&&d.types.length>0&&d.types.length<=40&&Array.isArray(d.links)&&d.links.length<=100,422,'INVALID_DEFINITION','类型或关系数量无效');
 const ids=new Set<string>();
 for(const t of d.types){
  assert(t.importable===undefined||typeof t.importable==='boolean',422,'IMPORTABLE','类型导入能力无效');
  assert(identifier(t.id)&&!ids.has(t.id),422,'TYPE_ID','类型ID重复或无效');ids.add(t.id);
  assert(typeof t.name==='string'&&t.name.length>0&&t.name.length<=100&&t.properties&&Object.keys(t.properties).length<=50,422,'TYPE_SCHEMA','名称或属性无效');
  for(const [name,p] of Object.entries(t.properties)){
   assert(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)&&!['__proto__','constructor','prototype'].includes(name)&&p&&['string','integer','number','boolean','date','datetime'].includes(p.type),422,'PROPERTY_TYPE','属性名或类型无效');
   assert(!p.mode||['source','computed','editable'].includes(p.mode),422,'PROPERTY_MODE','属性类别无效');
   assert(!p.conflict||['source','override','review'].includes(p.conflict),422,'PROPERTY_CONFLICT','更新策略无效');
   for(const key of ['name','description'] as const)assert(p[key]===undefined||typeof p[key]==='string'&&p[key]!.length<=1000,422,'PROPERTY_METADATA','属性说明无效');
   assert(p.format===undefined||['text','number','money','date'].includes(p.format),422,'PROPERTY_FORMAT','格式无效');
   assert((p.min===undefined||Number.isFinite(p.min))&&(p.max===undefined||Number.isFinite(p.max))&&(p.min===undefined||p.max===undefined||p.min<=p.max),422,'PROPERTY_RANGE','属性范围无效');
   assert(p.enum===undefined||Array.isArray(p.enum)&&p.enum.length>0&&p.enum.length<=100&&p.enum.every(v=>v===null||['string','boolean','number'].includes(typeof v)),422,'PROPERTY_ENUM','枚举无效');
  }
  assert(t.properties[t.primaryKey]?.type==='string'&&t.properties[t.primaryKey]?.mode!=='editable'&&t.properties[t.title],422,'PRIMARY_KEY','主键须为不可编辑文本属性；标题须存在');
  for(const [prop,m] of Object.entries(t.mapping??{}))assert(t.properties[prop]&&typeof m.field==='string'&&m.field.length<=100&&(m.scale===undefined||typeof m.scale==='number'&&Number.isFinite(m.scale)),422,'MAPPING','字段映射无效');
  assert(!t.effectiveField||t.properties[t.effectiveField]?.type==='date'||t.properties[t.effectiveField]?.type==='datetime',422,'EFFECTIVE_FIELD','有效时间字段须为日期');
 }
 const links=new Set<string>();
 for(const l of d.links){
  assert(identifier(l.id)&&!links.has(l.id)&&ids.has(l.from)&&ids.has(l.to)&&['many-to-one','one-to-one','many-to-many'].includes(l.cardinality),422,'LINK_TYPE','关系定义无效');links.add(l.id);
  assert(typeof l.name==='string'&&l.name.trim().length>0&&l.name.length<=100,422,'LINK_NAME','关系须有100字以内的业务名称');
  for(const key of ['outName','inName','description'] as const)assert(l[key]===undefined||typeof l[key]==='string'&&l[key]!.length<=1000,422,'LINK_METADATA','关系说明或显示名称无效');
  if(l.cardinality==='many-to-many'){const t=d.types.find(t=>t.id===l.through?.typeId);assert(t&&t.properties[l.through!.fromProperty]?.type==='string'&&t.properties[l.through!.toProperty]?.type==='string',422,'LINK_PROPERTY','多对多关系需要声明关联对象类型及两端文本键');}
  else assert(d.types.find(t=>t.id===l.from)?.properties[l.property]?.type==='string',422,'LINK_PROPERTY','关系源属性须为文本');
 }
 for(const [id,a]of Object.entries(d.agentAccess??{})){const t=d.types.find(t=>t.id===id);assert(t&&Array.isArray(a.roles)&&a.roles.every(r=>['conversion','supply','market','joint','orchestrator'].includes(r))&&Array.isArray(a.properties)&&a.properties.every(k=>t.properties[k]),422,'AGENT_ACCESS','Agent类型或属性授权无效');}
 return structuredClone(d);
}
export function scalarValue(v:unknown,p:Property):Scalar{
 const value=convertScalar(v,p);
 assert(!p.enum||p.enum.includes(value),422,'PROPERTY_ENUM','值不属于允许枚举');
 if(typeof value==='number')assert((p.min===undefined||value>=p.min)&&(p.max===undefined||value<=p.max),422,'PROPERTY_RANGE','数值超出允许范围');
 return value;
}
function convertScalar(v:unknown,p:Property):Scalar{
 if(v===null||v===undefined||v===''){assert(!p.required,422,'REQUIRED_PROPERTY','必填值缺失');return null;}
 if(p.type==='string'){assert(typeof v==='string'&&v.length<=2000,422,'PROPERTY_VALUE','需要文本，最多2000字符');const value=v.trim();assert(!p.required||!!value,422,'REQUIRED_PROPERTY','必填文本不能为空');return value;}
 if(p.type==='boolean'){assert(v===true||v===false||v==='true'||v==='false',422,'PROPERTY_VALUE','布尔值须为true/false');return v===true||v==='true';}
 if(p.type==='date'||p.type==='datetime'){
  assert(typeof v==='string'&&!Number.isNaN(Date.parse(v))&&(p.type==='datetime'?/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v):/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v).toISOString().slice(0,10)===v),422,'PROPERTY_VALUE','日期或带时区时间无效');if(p.type==='datetime'){try{return parseTime(v);}catch{assert(false,422,'PROPERTY_VALUE','不存在的日期或时区');}}return v;
 }
 const n=typeof v==='number'?v:typeof v==='string'&&v.trim()?Number(v):NaN;
 assert(Number.isFinite(n)&&(p.type!=='integer'||Number.isSafeInteger(n)),422,'PROPERTY_VALUE','数值无效');return n;
}
export function mapRecord(row:Record<string,unknown>,t:ObjectType,sourceImport=false):Record<string,Scalar>{
 assert(!sourceImport||t.importable!==false,422,'GENERATED_TYPE','该类型由计算或Action产生，不能通过CSV写入');
 const result:Record<string,Scalar>={};
 for(const [name,p] of Object.entries(t.properties)){
  const m=t.mapping?.[name];let value=row[m?.field??name];
  if(p.mode==='computed'&&sourceImport)assert(value===undefined||value===null||value==='',422,'COMPUTED_PROPERTY','计算属性不能通过CSV写入');
  if(m?.scale!==undefined&&value!==undefined&&value!==null&&value!=='')value=Number(value)*m.scale;
  result[name]=scalarValue(value,propertyRule(t,name,p));
 }
 assert(typeof result[t.primaryKey]==='string'&&!!result[t.primaryKey],422,'PRIMARY_KEY','主键不能为空');return result;
}
export function recordIssues(row:Record<string,unknown>,t:ObjectType,sourceImport=false){
 const issues:Array<{field:string;sourceField:string;constraintCode:string;message:string}>=[];
 for(const [field,p] of Object.entries(t.properties)){
  const m=t.mapping?.[field],sourceField=m?.field??field;let value=row[sourceField];
  try{if(sourceImport&&p.mode==='computed')assert(value===undefined||value===null||value==='',422,'COMPUTED_PROPERTY','计算属性不能通过CSV写入');
   if(m?.scale!==undefined&&value!==undefined&&value!==null&&value!=='')value=Number(value)*m.scale;
   scalarValue(value,propertyRule(t,field,p));
  }catch(e){issues.push({field,sourceField,constraintCode:e instanceof ApiError?e.code:'PROPERTY_VALUE',message:e instanceof Error?e.message:'值无效'});}
 }
 return issues;
}
export function queryObjects(objects:BusinessObject[],links:BusinessLink[],definition:Definition,q:ObjectQuery){
 const type=definition.types.find(t=>t.id===q.typeId);assert(type,422,'UNKNOWN_TYPE','对象类型不存在');
 assert(!q.filters||Array.isArray(q.filters)&&q.filters.length<=20,422,'FILTER_LIMIT','筛选条件过多');
 for(const f of q.filters??[]){
  const p=type.properties[f.property];assert(p&&['eq','in','gte','lte','isNull'].includes(f.op),422,'FILTER','未知属性或筛选操作');
  if(f.op==='in'){assert(Array.isArray(f.value)&&f.value.length<=100,422,'FILTER_VALUE','in需要最多100个值');for(const v of f.value)scalarValue(v,p);}
  else if(f.op!=='isNull')scalarValue(f.value,p);
  if(f.op==='gte'||f.op==='lte')assert(['integer','number','date','datetime'].includes(p.type),422,'FILTER_TYPE','此属性不支持范围筛选');
 }
 let result=objects.filter(o=>o.typeId===q.typeId&&(q.filters??[]).every(f=>{
  const v=o.properties[f.property];if(f.op==='isNull')return v===null||v===undefined;
  if(f.op==='eq')return v===scalarValue(f.value,type.properties[f.property]);
  if(f.op==='in')return (f.value as Scalar[]).map(x=>scalarValue(x,type.properties[f.property])).includes(v);
  const compare=scalarValue(f.value,type.properties[f.property]);return (typeof v==='number'&&typeof compare==='number'||typeof v==='string'&&typeof compare==='string')&&(f.op==='gte'?v!>=compare!:v!<=compare!);
 }));
 let outputType=type;
 if(q.traverse){
  const l=definition.links.find(l=>l.id===q.traverse!.linkId),dir=q.traverse.direction;
  assert(l&&['out','in'].includes(dir)&&(dir==='out'?l.from:l.to)===q.typeId,422,'TRAVERSE','关系与对象类型不匹配');
  const keys=new Set(result.map(o=>o.id));const dest=new Set(links.filter(x=>x.linkId===l.id&&keys.has(dir==='out'?x.fromId:x.toId)).map(x=>dir==='out'?x.toId:x.fromId));
  outputType=definition.types.find(t=>t.id===(dir==='out'?l.to:l.from))!;
  result=objects.filter(o=>o.typeId===outputType.id&&dest.has(o.id));
 }
 let aggregate:Record<string,unknown>|null=null;
 if(q.aggregate){
  assert(['count','sum'].includes(q.aggregate.op),422,'AGGREGATE','聚合操作无效');
  if(q.aggregate.op==='count')aggregate={value:result.length,unit:'个'};
  else{const prop=q.aggregate.property!,p=outputType.properties[prop];assert(p&&['integer','number'].includes(p.type),422,'AGGREGATE_TYPE','sum需要数值属性');const values=result.map(o=>o.properties[prop]).filter((v):v is number=>typeof v==='number');const sum=values.reduce((a,b)=>a+b,0);assert(Number.isFinite(sum),422,'OVERFLOW','汇总溢出');aggregate={value:values.length?sum:null,unit:p.unit??null,missing:result.length-values.length};}
 }
 if(q.sort){assert(outputType.properties[q.sort.property]&&['asc','desc'].includes(q.sort.direction),422,'SORT','排序无效');const {property,direction}=q.sort;result.sort((a,b)=>{const x=a.properties[property],y=b.properties[property];const c=x==null?(y==null?0:1):y==null?-1:x<y?-1:x>y?1:0;return (x==null||y==null?c:direction==='desc'?-c:c)||a.id.localeCompare(b.id);});}
 const cursor=q.cursor??0,limit=q.limit??50;assert(Number.isInteger(cursor)&&cursor>=0&&Number.isInteger(limit)&&limit>=1&&limit<=100,422,'PAGINATION','分页无效');
 return {typeId:outputType.id,items:result.slice(cursor,cursor+limit),total:result.length,nextCursor:cursor+limit<result.length?cursor+limit:null,aggregate};
}

export function neoDefinitionV2():Definition{
 const d=neoDefinition();d.version='neo-default-v2';
 const labels:Record<string,string>={id:'标识',name:'名称',productId:'商品',skuId:'SKU',warehouseId:'仓库',channelId:'渠道',date:'业务日期',quantity:'数量',amountCents:'金额',costCents:'成本',sellableUnits:'可售库存',inTransitUnits:'在途库存',safetyUnits:'安全库存',roleId:'商品角色',units:'件数',snapshotId:'经营快照',reason:'选择原因',actualOutcome:'实际结果',asOf:'经营截至'};
 for(const t of d.types){for(const [id,p]of Object.entries(t.properties)){p.name=labels[id]??id;p.format=p.unit==='分'?'money':p.type==='number'||p.type==='integer'?'number':p.type==='date'||p.type==='datetime'?'date':'text';}if(t.id==='inventory')t.properties.safetyUnits.min=0;}
 for(const l of d.links){l.outName=l.name;l.inName=d.types.find(t=>t.id===l.from)!.name;}
 for(const [id,name,props]of [
 ['feature_snapshot','特征输入',{skuId:txt(true),channelId:txt(),forecastId:txt(),asOf:{type:'date'},lag1Units:num('件'),lag4MeanUnits:num('件'),sellableUnits:num('件'),knownArrivalUnits:num('件')}],
 ['forecast_line','预测明细',{forecastId:txt(true),featureId:txt(),skuId:txt(true),channelId:txt(),weekStart:{type:'date'},weekEnd:{type:'date'},baselineUnits:num('件'),fulfillableUnits:num('件')}],
 ['forecast_evaluation','预测评估',{forecastId:txt(),status:txt(),asOf:{type:'date'},wape:num(),bias:num(),actualUnits:num('件')}],
 ]as Array<[string,string,Record<string,Property>]>)d.types.push(type(id,name,Object.fromEntries(Object.entries(props).map(([k,p])=>[k,{...p,name:labels[k]??k,mode:'computed' as const}])), 'id',{importable:false}));
 for(const [id,name,from,to,property]of [['feature_channel','特征渠道','feature_snapshot','channel','channelId'],['feature_forecast','特征预测','feature_snapshot','forecast','forecastId'],['feature_sku','特征SKU','feature_snapshot','sku','skuId'],['line_forecast','所属预测','forecast_line','forecast','forecastId'],['forecast_sku','预测SKU','forecast_line','sku','skuId'],['forecast_channel','预测渠道','forecast_line','channel','channelId'],['line_feature','输入特征','forecast_line','feature_snapshot','featureId'],['evaluation_forecast','评估预测','forecast_evaluation','forecast','forecastId']])d.links.push({id,name,from,to,property,cardinality:'many-to-one',outName:name,inName:'相关'+name});
 return d;
}

// Separate read-only types keep room nights, material quantities and paid units
// from inheriting the legacy order_line model and its 28-day calculation.
export function neoOperatingDefinition():Definition{
 const d=neoDefinitionV2();d.version='neo-operating-v1';
 const names:Record<InputKind,string>={order:'支付记录',expense:'经营费用',event:'阶段行为',inventory:'库存观测',arrival:'登记到货',fulfillment_rule:'履约规则',hotel_reservation:'酒店预订',hotel_capacity:'房晚能力',hotel_stay:'已入住房晚',hotel_service_capacity:'酒店服务能力',material_inventory:'物料库存',bom:'物料清单',production_capacity:'生产能力',production:'登记生产'};
 for(const kind of INPUT_KINDS){
  const properties:Record<string,Property>={id:txt(true),recordKey:txt(true),sourceId:txt(true),entityId:txt(true),businessDate:{type:'date',required:true},knownAt:{type:'datetime',required:true},generationId:txt(true),profileVersion:txt(true),revision:{type:'integer',required:true}};
  for(const key of ['channelId','warehouseId','fromWarehouseId','customerId','orderId','orderLineId','entryType','stage','materialId','workCenterId','status','supersedesId'])properties[key]=txt();
  for(const key of ['quantity','amountCents','variableCostCents','inventoryCostCents','reservedUnits','inspectionUnits','unitsPerProduct','leadDays','costCents'])properties[key]=num(key.endsWith('Cents')?'分':key==='leadDays'?'天':key==='unitsPerProduct'?'物料单位/件':kind.startsWith('hotel_')?'房晚':kind==='event'?'次':kind==='material_inventory'?'物料单位':'件');
  for(const property of Object.values(properties))property.mode='source';
  d.types.push(type('operating_'+kind,names[kind],properties,'entityId',{importable:false,planned:true}));
 }
 return d;
}
