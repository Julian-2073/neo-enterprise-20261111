import type {Context} from '../auth.ts';
import {assert} from '../errors.ts';
import {first} from '../store.ts';
import {definition,capture} from './store.ts';
import {project} from './project.ts';
import {mapRecord,recordIssues,validateDefinition,type Definition} from './model.ts';
export function definitionChanges(a:Definition,b:Definition){return {from:a.version,to:b.version,types:[...new Set([...a.types.map(t=>t.id),...b.types.map(t=>t.id)])].filter(id=>JSON.stringify(a.types.find(t=>t.id===id))!==JSON.stringify(b.types.find(t=>t.id===id))).map(id=>({id,before:a.types.find(t=>t.id===id)??null,after:b.types.find(t=>t.id===id)??null})),links:[...new Set([...a.links.map(l=>l.id),...b.links.map(l=>l.id)])].filter(id=>JSON.stringify(a.links.find(l=>l.id===id))!==JSON.stringify(b.links.find(l=>l.id===id))).map(id=>({id,before:a.links.find(l=>l.id===id)??null,after:b.links.find(l=>l.id===id)??null})),agentAccessChanged:JSON.stringify(a.agentAccess)!==JSON.stringify(b.agentAccess)};}
export async function definitionDiff(ctx:Context,id:string,n:string){
 const row=await first<{payload:string;base_id:string}>(ctx.db,'SELECT payload,base_id FROM ontology_definitions WHERE business_id=? AND id=?',ctx.businessId,id);assert(row,404,'NOT_FOUND','定义不存在');const d=validateDefinition(JSON.parse(row.payload)),base=await definition(ctx,row.base_id),input=await capture(ctx,{dataNature:n,definitionId:base.version});const p=project(input.data,d,input.asOf);
 return {...definitionChanges(base,d),impact:{functions:['metrics','forecast','scenario'],agents:['conversion','supply','market','joint','orchestrator']},candidateQuality:{counts:p.counts,issues:p.issues,valid:!p.issues.some(i=>i.severity==='error')}};
}
export function mappingPreview(body:Record<string,unknown>){const d=validateDefinition(body.definition),t=d.types.find(t=>t.id===body.typeId);assert(t,422,'TYPE','类型不存在');assert(Array.isArray(body.rows)&&body.rows.length<=50,422,'ROWS','预览最多50行');return {rows:body.rows.map((r,i)=>{const issues:Array<Record<string,unknown>>=recordIssues(r as Record<string,unknown>,t,true);try{return {row:i+1,source:r,value:mapRecord(r as Record<string,unknown>,t,true),issues};}catch(e){if(!issues.length)issues.push({message:e instanceof Error?e.message:'值无效'});return {row:i+1,source:r,value:null,issues};}})};}
