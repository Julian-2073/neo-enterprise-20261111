import type {Definition, ObjectType, Property, QualityIssue} from '../server/ontology/model';

// Shared with record validation: the displayed rules must describe the actual validator.
export function propertyRule(type: Pick<ObjectType,'id'|'primaryKey'>, key:string, p:Property):Property {
 return {...p,...(key===type.primaryKey?{required:true}:{}),...(type.id==='inventory'&&key==='safetyUnits'?{min:Math.max(0,p.min??0)}:{})};
}
export function constraintText(type:ObjectType,key:string,p:Property){
 const rule=propertyRule(type,key,p);
 return [rule.required?'必填':rule.enum&&!rule.enum.includes(null)?'须属于允许值':'可为空',key===type.primaryKey?'稳定主键':null,rule.min!==undefined&&['number','integer'].includes(p.type)?`最小 ${rule.min}`:null,rule.max!==undefined&&['number','integer'].includes(p.type)?`最大 ${rule.max}`:null,rule.enum?`允许值 ${rule.enum.map(v=>JSON.stringify(v)).join('、')}`:null].filter(Boolean).join(' · ');
}
export const cardinalityText={'many-to-one':'多对一','one-to-one':'一对一','many-to-many':'多对多'} as const;
export function modelIri(businessId:string,kind:'type'|'property'|'link',id:string){return `urn:neo:ontology:${encodeURIComponent(businessId)}:${kind}:${encodeURIComponent(id)}`;}
export function modelPackage(d:Definition,businessId:string,scope:Record<string,unknown>){
 return {format:'neo-ontology-design-v1',scope:{businessId,definitionId:d.version,...scope},boundary:'配置导出，不包含业务对象、运行结果或推理结果；运行校验以 NEO 验证器为准',definition:d,
  constraints:d.types.map(t=>({typeId:t.id,iri:modelIri(businessId,'type',t.id),primaryKey:t.primaryKey,properties:Object.fromEntries(Object.entries(t.properties).map(([key,p])=>[key,{...propertyRule(t,key,p),iri:modelIri(businessId,'property',`${t.id}.${key}`)}]))}))};
}
// A portable vocabulary graph, not an OWL reasoner or a SHACL validation report.
export function vocabularyGraph(d:Definition,businessId:string){
 const datatype={string:'xsd:string',integer:'xsd:integer',number:'xsd:double',boolean:'xsd:boolean',date:'xsd:date',datetime:'xsd:dateTime'};
 const typeIri=(id:string)=>modelIri(businessId,'type',id);
 return {'@context':{rdf:'http://www.w3.org/1999/02/22-rdf-syntax-ns#',rdfs:'http://www.w3.org/2000/01/rdf-schema#',xsd:'http://www.w3.org/2001/XMLSchema#',neo:'urn:neo:vocabulary:',domain:{'@id':'rdfs:domain','@type':'@id'},range:{'@id':'rdfs:range','@type':'@id'}},'@graph':[
  ...d.types.flatMap(t=>[{'@id':typeIri(t.id),'@type':'rdfs:Class','rdfs:label':t.name,'neo:primaryKey':t.primaryKey},...Object.entries(t.properties).map(([key,p])=>{const rule=propertyRule(t,key,p);return {'@id':modelIri(businessId,'property',`${t.id}.${key}`),'@type':'rdf:Property','rdfs:label':p.name??key,...(p.description?{'rdfs:comment':p.description}:{}),domain:typeIri(t.id),range:datatype[p.type],'neo:required':!!rule.required,...(rule.min!==undefined?{'neo:min':rule.min}:{}),...(rule.max!==undefined?{'neo:max':rule.max}:{}),...(rule.enum?{'neo:enumJson':JSON.stringify(rule.enum)}:{}),...(p.unit?{'neo:unit':p.unit}:{})};})]),
  ...d.links.map(l=>({'@id':modelIri(businessId,'link',l.id),'@type':'rdf:Property','rdfs:label':l.name,...(l.description?{'rdfs:comment':l.description}:{}),domain:typeIri(l.from),range:typeIri(l.to),'neo:cardinality':l.cardinality,'neo:bindingJson':JSON.stringify(l.cardinality==='many-to-many'?l.through:{property:l.property}),'neo:inference':'none'}))]};
}
export function qualityAdvice(issue:QualityIssue){
 switch(issue.code){
  case 'REFERENCE_ONLY':case 'MISSING_MASTER':return '补充对应类型的主数据，再构建新投影；当前引用不会自动补造。';
  case 'ORPHAN_LINK':return '核对关联键与目标主键，补充缺失对象后重新构建。';
  case 'LINK_CARDINALITY':return '检查重复目标或关联记录；一对一关系不能共用目标。';
  case 'OBJECT_CONFLICT':return '核对同一主键、同一可用时点的多份来源内容。';
  case 'EDIT_REVIEW':return '比较新源数据与人工编辑，通过 Action 重新确认。';
  default:return '核对源字段、必填值、类型、单位转换和允许范围；修正后重新上传或构建。';
 }
}
export function filterIssues(issues:QualityIssue[],filters:{severity:string;typeId:string;search:string}){
 const search=filters.search.trim().toLocaleLowerCase();return issues.filter(i=>(!filters.severity||i.severity===filters.severity)&&(!filters.typeId||i.typeId===filters.typeId)&&(!search||[i.code,i.objectId,i.field,i.message,i.row].join(' ').toLocaleLowerCase().includes(search)));
}
