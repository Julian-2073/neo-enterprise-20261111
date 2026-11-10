import type {Context} from '../auth.ts';
import {assert} from '../errors.ts';
import {first,statement} from '../store.ts';
import {querySql} from './query.ts';
type ResultFeature=Record<string,unknown>&{skuId?:string|null;channelId?:string|null};
type ResultLine=ResultFeature&{salesBaselineUnits?:number|null;fulfillableUnits?:number|null};
type ResultArtifact=Record<string,unknown>&{id:string;kind:string;createdAt?:string;ontologyRef?:{buildId:string}|null;totals?:{units?:number|null};featureSnapshots?:ResultFeature[];forecastLines?:ResultLine[]};
// Results are immutable, published in the same transaction as their artifact, pinned to the input build.
export function resultStatements(ctx:Context,value:ResultArtifact){
 const ref=value.ontologyRef;assert(ref?.buildId,422,'RESULT_SCOPE','结果必须绑定输入投影');const at=value.createdAt,items:Array<{typeId:string;id:string;properties:Record<string,unknown>}>=[],links:Array<{linkId:string;fromId:string;toId:string}>=[];
 const add=(typeId:string,id:string,properties:Record<string,unknown>)=>items.push({typeId,id,properties:{id,...properties}});
 const link=(linkId:string,fromId:string,toId:unknown)=>{if(toId!=null&&toId!=='')links.push({linkId,fromId,toId:String(toId)});};
 add(value.kind,value.id,{...value,units:value.totals?.units??null});
 for(const [i,f] of (value.kind==='forecast'?value.featureSnapshots??[]:[]).entries()){const id=`${value.id}:feature:${i}`;add('feature_snapshot',id,{...f,forecastId:value.id});link('feature_sku',id,f.skuId);link('feature_channel',id,f.channelId);link('feature_forecast',id,value.id);}
 for(const [i,l] of (value.kind==='forecast'?value.forecastLines??[]:[]).entries()){const id=`${value.id}:line:${i}`,feature=(value.featureSnapshots??[]).findIndex(f=>f.skuId===l.skuId&&f.channelId===l.channelId);add('forecast_line',id,{...l,forecastId:value.id,featureId:feature>=0?`${value.id}:feature:${feature}`:null,baselineUnits:l.salesBaselineUnits,fulfillableUnits:l.fulfillableUnits,modelVersion:value.modelVersion??'four-week-mean',inputRef:ref});link('line_forecast',id,value.id);link('forecast_sku',id,l.skuId);link('forecast_channel',id,l.channelId);if(feature>=0)link('line_feature',id,`${value.id}:feature:${feature}`);}
 if(value.kind==='forecast_evaluation')link('evaluation_forecast',value.id,value.forecastId);
 if(value.kind==='decision')link('decision_scenario',value.id,value.scenarioId);
 const provenance=[{kind:'artifact',id:value.id,availableAt:at,availability:'system_recorded',inputRef:ref}];
 const objects=items.map(o=>({id:`${value.id}:${o.typeId}:${o.id}`,typeId:o.typeId,objectId:o.id,title:value.title??o.id,properties:JSON.stringify(o.properties)}));const edges=links.map((l,i)=>({...l,id:`${value.id}:link:${i}`}));
 return [statement(ctx.db,"INSERT OR IGNORE INTO ontology_result_objects(id,business_id,data_nature,build_id,artifact_id,type_id,object_id,title,properties,provenance,available_at) SELECT json_extract(value,'$.id'),?,?,?,?,json_extract(value,'$.typeId'),json_extract(value,'$.objectId'),json_extract(value,'$.title'),json_extract(value,'$.properties'),?,? FROM json_each(?)",ctx.businessId,value.dataNature,ref.buildId,value.id,JSON.stringify(provenance),at,JSON.stringify(objects)),statement(ctx.db,"INSERT OR IGNORE INTO ontology_result_links(id,business_id,data_nature,build_id,artifact_id,link_id,from_id,to_id,available_at) SELECT json_extract(value,'$.id'),?,?,?,?,json_extract(value,'$.linkId'),json_extract(value,'$.fromId'),json_extract(value,'$.toId'),? FROM json_each(?)",ctx.businessId,value.dataNature,ref.buildId,value.id,at,JSON.stringify(edges))];
}
export async function resultQuery(ctx:Context,input:Record<string,unknown>){return querySql(ctx,input,true);}
export async function resultArtifact(ctx:Context,id:string,n:string,buildId?:string|null){const a=await first<{payload:string}>(ctx.db,'SELECT payload FROM neo_artifacts WHERE id=? AND business_id=? AND data_nature=?',id,ctx.businessId,n);assert(a,404,'NOT_FOUND','结果不存在');const value=JSON.parse(a.payload);if(buildId)assert(value.ontologyRef?.buildId===buildId,404,'RESULT_SCOPE','结果不属于当前输入投影');return value;}
