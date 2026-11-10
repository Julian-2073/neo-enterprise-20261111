import type {Provenance} from '../server/ontology/model.ts';
import type {ProjectionInput} from '../server/ontology/project.ts';
type ProjectionRef={id:string;definitionId:string;asOf:string;knownAt:string;snapshotId?:string|null};
/** Pin the object explorer to the same immutable input as the selected graph. */
export function objectExplorerHref(businessId:string,dataNature:string,typeId:string,build:ProjectionRef){
 const params=new URLSearchParams({view:'objects',businessId,dataNature,resourceId:`type:${typeId}`,buildId:build.id,definitionId:build.definitionId,asOf:build.asOf,knownAt:build.knownAt});
 if(build.snapshotId)params.set('snapshotId',build.snapshotId);
 return `/data/ontology?${params}`;
}
/** Read evidence from frozen projection input, never from live master records. */
export function sourceEvidence(provenance:Provenance[],input:ProjectionInput){
 return {total:provenance.length,items:provenance.slice(0,20).map(p=>{
  let record:unknown=null;
  if(p.kind==='fact')record=input.facts.find(r=>r.id===p.id&&r.batchId===p.batchId&&r.row===p.row)?.fact??null;
  else if(p.kind==='ontology_import'&&Number.isInteger(p.row)&&p.row!>0)record=input.imports.find(r=>r.id===p.id)?.rows[p.row!-1]??null;
  else if(p.kind==='domain')record=input.domain.find(r=>r.id===p.id)?.payload??null;
  else if(p.kind==='operating_input')record=input.operating?.inputs.find(r=>r.id===p.id)??null;
  else if(p.kind==='artifact')record=input.artifacts.find(r=>r.id===p.id)?.payload??null;
  else if(p.kind==='edit')record=input.edits.find(r=>r.id===p.id)??null;
  return {provenance:p,record};
 })};
}
