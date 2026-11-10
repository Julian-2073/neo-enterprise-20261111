import {loadGeneration} from '../generation-storage.ts';
import {generationSnapshot} from '../workbench-projection.ts';
import {readMaterials,canonicalCustomer,selectMaterial} from '../materials/validation.ts';
import {projectMaterials} from '../materials/projection.ts';
import type {Snapshot,Fact} from "../contracts.ts";
import {assert} from '../errors.ts';
import {encodeInput,decodeInput} from '../input-storage.ts';
import {all,first,statement,writeJsonChunks} from '../store.ts';
import type {Context} from '../auth.ts';
import {hash} from '../csv.ts';
import {neoDefinition,neoDefinitionV2,neoOperatingDefinition,validateDefinition,scalarValue,type Definition,type BusinessObject,type BusinessLink} from './model.ts';
import {project,type ProjectionInput} from './project.ts';
export const now=()=>new Date().toISOString();
export const uid=(name:string)=>`${name}-${crypto.randomUUID()}`;
export function text(x:unknown,name:string,max=200){assert(typeof x==='string'&&!!x.trim()&&x.length<=max,422,'INVALID_FIELD',`${name}无效`);return x.trim();}
export function nature(x:unknown){assert(x==='demo'||x==='business',422,'INVALID_NATURE','请选择demo或business');return x;}
export type BuildRow={id:string;business_id:string;data_nature:string;definition_id:string;snapshot_id:string|null;generation_id?:string|null;as_of:string;known_at:string;source_hash:string;status:string;input:string;issues:string;counts:string;created_at:string};
export async function definition(ctx:Context,id?:unknown):Promise<Definition>{
 if(id==='neo-operating-v1')return neoOperatingDefinition();
 if(id==='neo-default-v1')return neoDefinition(id);if(id==='neo-default-v2')return neoDefinitionV2();
 const row=id?await first<{payload:string;id:string}>(ctx.db,"SELECT id,payload FROM ontology_definitions WHERE id=? AND business_id=? AND status='published'",text(id,'definitionId'),ctx.businessId):await first<{id:string;payload:string}>(ctx.db,"SELECT id,payload FROM ontology_definitions WHERE business_id=? AND status='published' ORDER BY published_at DESC,id DESC LIMIT 1",ctx.businessId);
 if(id)assert(row,404,'NOT_FOUND','定义版本不存在');return row?{...JSON.parse(row.payload),version:row.id}:neoDefinitionV2();
}
export async function createDraft(ctx:Context,input:Record<string,unknown>){
 assert(ctx.role==='admin',403,'ADMIN_REQUIRED','仅管理员可配置类型');const current=await definition(ctx);assert(input.baseId===current.version,409,'VERSION_CONFLICT','定义版本已变化');
 const d=validateDefinition(input.definition),id=uid('definition');d.version=id;
 await statement(ctx.db,"INSERT INTO ontology_definitions(id,business_id,base_id,status,payload,actor_id,created_at,published_at) VALUES(?,?,?,'draft',?,?,?,NULL)",id,ctx.businessId,current.version,JSON.stringify(d),ctx.userId,now()).run();return {id,baseId:current.version,status:'draft',definition:d};
}
export async function publishDraft(ctx:Context,id:string){
 assert(ctx.role==='admin',403,'ADMIN_REQUIRED','仅管理员可发布定义');
 const row=await first<{id:string;base_id:string;status:string;payload:string}>(ctx.db,'SELECT * FROM ontology_definitions WHERE business_id=? AND id=?',ctx.businessId,id);assert(row,404,'NOT_FOUND','草稿不存在');
 if(row.status==='published')return {id,status:'published'};
 validateDefinition(JSON.parse(row.payload));const current=await definition(ctx);assert(current.version===row.base_id,409,'VERSION_CONFLICT','草稿基于旧定义，请重新核对');
 const r=await statement(ctx.db,"UPDATE ontology_definitions SET status='published',published_at=? WHERE id=? AND business_id=? AND status='draft' AND base_id=COALESCE((SELECT id FROM ontology_definitions WHERE business_id=? AND status='published' ORDER BY published_at DESC,id DESC LIMIT 1),?)",now(),id,ctx.businessId,ctx.businessId,neoDefinition().version).run();
 assert(r.meta.changes===1,409,'VERSION_CONFLICT','定义已并发变化');return {id,status:'published'};
}
export async function getBuild(ctx:Context,id:unknown,dataNature?:unknown){
 const row=await first<BuildRow>(ctx.db,'SELECT * FROM ontology_builds WHERE id=? AND business_id=?',text(id,'buildId'),ctx.businessId);assert(row&&(!dataNature||row.data_nature===dataNature),404,'NOT_FOUND','投影版本不存在');return {...row,snapshot_id:row.snapshot_id??row.generation_id??null};
}
export function publicBuild(row:BuildRow){return {id:row.id,businessId:row.business_id,dataNature:row.data_nature,definitionId:row.definition_id,snapshotId:row.snapshot_id??row.generation_id??null,generationId:row.generation_id??null,asOf:row.as_of,knownAt:row.known_at,status:row.status,sourceHash:row.source_hash,counts:JSON.parse(row.counts),issues:JSON.parse(row.issues),createdAt:row.created_at,availability:'system_recorded'};}
// Both legacy plain JSON and bounded lossless inputs use the same frozen payload.
export async function readBuildInput(build:BuildRow):Promise<ProjectionInput&{definition?:Definition}>{return await decodeInput(build.input);}
export async function buildData(ctx:Context,id:unknown,n?:unknown){
 const build=await getBuild(ctx,id,n);assert(['ready','partial'].includes(build.status),409,'BUILD_UNAVAILABLE','该投影未就绪');
 const savedDefinition=(await readBuildInput(build)).definition;const d=savedDefinition??await definition(ctx,build.definition_id);
 const rows=await all<{type_id:string;object_id:string;title:string;properties:string;provenance:string;reference_only:number}>(ctx.db,'SELECT * FROM ontology_objects WHERE build_id=? ORDER BY type_id,object_id',build.id);
 const objects:BusinessObject[]=rows.map(r=>({typeId:r.type_id,id:r.object_id,title:r.title,properties:JSON.parse(r.properties),provenance:JSON.parse(r.provenance),referenceOnly:!!r.reference_only}));
 const ls=await all<{link_id:string;from_id:string;to_id:string;provenance:string}>(ctx.db,'SELECT * FROM ontology_links WHERE build_id=? ORDER BY id',build.id);
 const links:BusinessLink[]=ls.map(l=>({linkId:l.link_id,fromId:l.from_id,toId:l.to_id,provenance:JSON.parse(l.provenance)}));return {build,definition:d,objects,links};
}
export async function query(ctx:Context,input:Record<string,unknown>){return (await import('./query.ts')).querySql(ctx,input);}
export async function capture(ctx:Context,input:Record<string,unknown>):Promise<{data:ProjectionInput;asOf:string;knownAt:string;nature:'demo'|'business';definition:Definition;snapshotId:string|null}>{
 const n=nature(input.dataNature);
 const generationId=input.generationId??(typeof input.snapshotId==='string'&&input.snapshotId.startsWith('generation-')?input.snapshotId:undefined);
 if(generationId){
  if(input.snapshotId)assert(input.snapshotId===generationId,409,'SNAPSHOT_SCOPE','经营代次与快照范围不一致');
  const row=await first<{payload:string}>(ctx.db,'SELECT payload FROM neo_business_generations WHERE id=? AND business_id=? AND data_nature=?',text(generationId,'generationId'),ctx.businessId,n);assert(row,404,'NOT_FOUND','经营代次不存在');
  const g=await loadGeneration(ctx,n,row.payload);
  assert(input.asOf===undefined||input.asOf===g.state.asOf,409,'SNAPSHOT_SCOPE','冻结代次的经营截止不可更改');
  assert(input.knownAt===undefined||input.knownAt===g.state.knownAt,409,'SNAPSHOT_KNOWLEDGE','冻结代次的知识截止不可更改');
  assert(g.state.inputs.length<=10000,413,'PROJECTION_LIMIT','单个对象投影最多10000条经营事实；完整经营代次仍保留');
  const d=await definition(ctx,input.definitionId??'neo-operating-v1');
  const data:ProjectionInput={snapshot:generationSnapshot(g) as unknown as Record<string,unknown>,facts:[],domain:[],imports:[],artifacts:[],edits:[],operating:{generationId:g.id,profileVersion:g.state.profileVersion,availableAt:g.state.knownAt,inputs:g.state.inputs}};
  return {data,asOf:g.state.asOf,knownAt:g.state.knownAt,nature:n,definition:d,snapshotId:g.id};
 }
 const d=await definition(ctx,input.definitionId);let s:Record<string,unknown>|undefined;
 if(input.snapshotId){const row=await first<{payload:string;generated_at:string}>(ctx.db,'SELECT payload,generated_at FROM operating_snapshots WHERE id=? AND business_id=? AND data_nature=?',text(input.snapshotId,'snapshotId'),ctx.businessId,n);assert(row,404,'NOT_FOUND','快照不存在');s={...JSON.parse(row.payload),generatedAt:row.generated_at};}
 const asOf=text(input.asOf??s?.asOf??new Date(Date.now()+8*3600000).toISOString().slice(0,10),'asOf');assert(/^\d{4}-\d{2}-\d{2}$/.test(asOf)&&!Number.isNaN(Date.parse(asOf))&&new Date(asOf).toISOString().slice(0,10)===asOf,422,'DATE','截至日期无效');
 const knownAt=String(scalarValue(text(input.knownAt??s?.knownAt??s?.generatedAt??now(),'knownAt'),{type:'datetime',required:true}));assert(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(knownAt)&&!Number.isNaN(Date.parse(knownAt))&&Date.parse(knownAt)<=Date.now()+1000,422,'KNOWN_AT','可用截止须为不晚于现在的带时区时间');const at=new Date(knownAt).toISOString();
 if(s?.domain)assert(at===s.knownAt,409,'SNAPSHOT_KNOWLEDGE','冻结快照的知识截止不可更改；请创建新快照');
 if(s){assert(asOf===s.asOf,409,'SNAPSHOT_SCOPE','投影截至日必须与快照一致');assert(Date.parse(at)<=Date.parse(String(s.knownAt??s.generatedAt)),409,'SNAPSHOT_KNOWLEDGE','快照不能加入后来取得的信息；请创建新快照');}
 const rows=await all<{id:string;kind:string;payload:string;source_id:string;batch_id:string;row_number:number;available_at:string}>(ctx.db,`SELECT DISTINCT f.*,b.committed_at available_at FROM business_facts f JOIN ingestion_batches b ON b.id=f.batch_id WHERE f.business_id=? AND f.data_nature=? AND f.kind IN ('events','orders','inventory','expenses') AND f.business_date<=? AND b.status='committed' AND b.committed_at<=? ${s?"AND f.id IN (SELECT ef.fact_id FROM evidence_facts ef JOIN evidence_records er ON er.id=ef.evidence_id WHERE er.business_id=? AND er.snapshot_id=?)":''} ORDER BY f.id LIMIT 10001`,ctx.businessId,n,asOf,at,...(s?[ctx.businessId,s.id]:[]));
 assert(rows.length<=10000,413,'PROJECTION_LIMIT','首版单个投影最多10000条事实，请缩小快照范围');
 const domains=await all<{id:string;kind:string;payload:string;created_at:string}>(ctx.db,'SELECT * FROM neo_domain_records WHERE business_id=? AND data_nature=? AND created_at<=? ORDER BY created_at,id',ctx.businessId,n,at);
 const imports=await all<{id:string;type_id:string;rows:string;committed_at:string}>(ctx.db,"SELECT * FROM ontology_imports WHERE business_id=? AND data_nature=? AND status='committed' AND committed_at<=? ORDER BY committed_at,id",ctx.businessId,n,at);
 const market=await all<{id:string;payload:string;created_at:string}>(ctx.db,`SELECT e.* FROM neo_market_evidence e JOIN neo_runs r ON r.id=e.run_id WHERE e.business_id=? AND r.data_nature=? AND e.created_at<=? ${s?'AND e.snapshot_id=?':''} ORDER BY e.created_at,e.id`,ctx.businessId,n,at,...(s?[s.id]:[]));
 const artifacts=await all<{id:string;kind:string;payload:string;created_at:string}>(ctx.db,`SELECT * FROM neo_artifacts WHERE business_id=? AND data_nature=? AND created_at<=? ${s?'AND snapshot_id=?':''} ORDER BY created_at,id`,ctx.businessId,n,at,...(s?[s.id]:[]));
 const edits=await all<{id:string;type_id:string;object_id:string;property:string;value:string;created_at:string}>(ctx.db,"SELECT * FROM ontology_edits WHERE business_id=? AND data_nature=? AND status='committed' AND created_at<=? ORDER BY created_at,id",ctx.businessId,n,at);
 const materials=!s?await readMaterials(ctx,n,at):[];assert(materials.length<=10000,413,'MATERIAL_LIMIT','资料版本超过10000条');
 const frozenDomain=s?.domain??(materials.length?projectMaterials(materials,[],{dataNature:n,knownAt:at,asOf,start:asOf,end:asOf,weeks:[],customerFunnel:null,observationCovered:false}).domain:undefined);
 const resolveFact=(id:string,payload:string)=>{const fact=JSON.parse(payload) as Fact;if(s){return {...fact,...((s as Snapshot).data?.materials?{resolved_customer_id:(s as Snapshot).data.materials!.customerLinks?.find(c=>c.factId===id)?.customerId??null}:{})};}const customer=canonicalCustomer(fact,materials);return {...fact,resolved_customer_id:customer&&selectMaterial(materials,'customers',customer,fact.business_date)?customer:null};};
 const data:ProjectionInput={snapshot:s,facts:rows.map(r=>({id:r.id,kind:r.kind,fact:resolveFact(r.id,r.payload),sourceId:r.source_id,batchId:r.batch_id,row:r.row_number,availableAt:r.available_at})),domain:frozenDomain?Object.entries(frozenDomain as Record<string,Array<Record<string,unknown>>>).flatMap(([kind,values])=>values.map(r=>({id:String(r.factId),kind,payload:r,availableAt:String(r.availableAt)}))):domains.map(r=>({id:r.id,kind:r.kind,payload:JSON.parse(r.payload),availableAt:r.created_at})),imports:imports.map(r=>({id:r.id,typeId:r.type_id,rows:JSON.parse(r.rows),availableAt:r.committed_at})),artifacts:[...artifacts.filter(r=>!JSON.parse(r.payload).resultLayerVersion).map(r=>({id:r.id,kind:r.kind,payload:JSON.parse(r.payload),availableAt:r.created_at})),...market.map(r=>({id:r.id,kind:'market_evidence',payload:JSON.parse(r.payload),availableAt:r.created_at}))],edits:edits.map(r=>({id:r.id,typeId:r.type_id,objectId:r.object_id,property:r.property,value:JSON.parse(r.value),availableAt:r.created_at}))};
 assert(data.imports.reduce((a,b)=>a+b.rows.length,0)+data.domain.length+data.artifacts.length<=10000,413,'PROJECTION_LIMIT','主数据规模超过首版投影限制');
 return {data,asOf,knownAt:at,nature:n,definition:d,snapshotId:s?String(s.id):null};
}
export async function createBuild(ctx:Context,input:Record<string,unknown>,override?:Awaited<ReturnType<typeof capture>>,deferPublish=false){
 const c=override??await capture(ctx,input),p=project(c.data,c.definition,c.asOf);const sourceHash=await hash(JSON.stringify([ctx.businessId,c.nature,c.definition,c.asOf,c.knownAt,c.data]));const id='build-'+sourceHash.slice(0,40);
 const existing=await first<BuildRow>(ctx.db,'SELECT * FROM ontology_builds WHERE id=? AND business_id=?',id,ctx.businessId);if(existing&&existing.status!=='building')return publicBuild(existing);
 const storedInput=await encodeInput({...c.data,definition:c.definition});
 const status=p.issues.some(i=>i.severity==='error')?'failed':p.issues.length?'partial':'ready';
 await statement(ctx.db,"INSERT OR IGNORE INTO ontology_builds(id,business_id,data_nature,definition_id,snapshot_id,generation_id,as_of,known_at,source_hash,status,input,issues,counts,created_at) VALUES(?,?,?,?,?,?,?,?,?, 'building',?,?,?,?)",id,ctx.businessId,c.nature,c.definition.version,c.data.operating?null:c.snapshotId,c.data.operating?.generationId??null,c.asOf,c.knownAt,sourceHash,storedInput,JSON.stringify(p.issues),JSON.stringify(p.counts),now()).run();
 try{
  if(status!=='failed'){
   await writeJsonChunks(ctx.db,p.objects.map(o=>({rowId:JSON.stringify([id,o.typeId,o.id]),buildId:id,...o,props:JSON.stringify(o.properties),prov:JSON.stringify(o.provenance)})),`INSERT OR IGNORE INTO ontology_objects SELECT json_extract(value,'$.rowId'),json_extract(value,'$.buildId'),json_extract(value,'$.typeId'),json_extract(value,'$.id'),json_extract(value,'$.title'),json_extract(value,'$.props'),json_extract(value,'$.prov'),json_extract(value,'$.referenceOnly') FROM json_each(?)`);
   await writeJsonChunks(ctx.db,p.links.map(l=>({rowId:JSON.stringify([id,l.linkId,l.fromId,l.toId]),buildId:id,...l,prov:JSON.stringify(l.provenance)})),`INSERT OR IGNORE INTO ontology_links SELECT json_extract(value,'$.rowId'),json_extract(value,'$.buildId'),json_extract(value,'$.linkId'),json_extract(value,'$.fromId'),json_extract(value,'$.toId'),json_extract(value,'$.prov') FROM json_each(?)`);
  }
  if(!deferPublish||status==='failed')await statement(ctx.db,'UPDATE ontology_builds SET status=? WHERE id=?',status,id).run();
  if(!deferPublish&&status!=='failed')await statement(ctx.db,'INSERT INTO ontology_heads(id,build_id,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET build_id=excluded.build_id,updated_at=excluded.updated_at',headKey(ctx,c.nature,c.asOf,c.snapshotId),id,now()).run();
 }catch(e){await statement(ctx.db,"UPDATE ontology_builds SET status='failed',issues=? WHERE id=?",JSON.stringify([...p.issues,{severity:'error',code:'BUILD_STORAGE',message:'投影写入未完成，请查看运行记录并重建'}]),id).run();throw e;}
 return publicBuild(await getBuild(ctx,id));
}
export async function envelopeForBuild(ctx:Context,id:unknown,n?:unknown){
 const data=await buildData(ctx,id,n),input=await readBuildInput(data.build);
 assert(input.snapshot,422,'SNAPSHOT_REQUIRED','计算或Agent需要先选择经营快照并构建对象视图');
 const domain:Record<string,unknown[]>={products:[],skus:[],roles:[],arrivals:[]};const types:Record<string,string>={product:'products',sku:'skus',role:'roles',arrival:'arrivals'};
 for(const o of data.objects)if(types[o.typeId]&&!o.referenceOnly)domain[types[o.typeId]].push(o.properties);
 const ref={buildId:data.build.id,definitionId:data.definition.version,sourceHash:data.build.source_hash,asOf:data.build.as_of,knownAt:data.build.known_at};
 const env={snapshot:input.snapshot,facts:input.facts.map(r=>({id:r.id,kind:r.kind,fact:r.fact,availableAt:r.availableAt,sourceId:r.sourceId,batchId:r.batchId,row:r.row})),domain,ontology:{ref,definition:data.definition,objects:data.objects,links:data.links},ontologyRef:ref};
 const size=new TextEncoder().encode(JSON.stringify(env)).length;
 if(size<1900000)return env;
 assert(size<=16*1024*1024,413,'INPUT_LIMIT','当前对象范围超过首版限制，请缩小快照；没有截断输入');
 // Preserve every object/link/provenance while avoiding repeated JSON exceeding the existing service envelope limit.
 const stream=new Blob([JSON.stringify(env.ontology)]).stream().pipeThrough(new CompressionStream('gzip'));
 const compressed=new Uint8Array(await new Response(stream).arrayBuffer());let binary='';for(let i=0;i<compressed.length;i+=8192)binary+=String.fromCharCode(...compressed.subarray(i,i+8192));
 const packed={...env,ontology:undefined,ontologyPacked:{codec:'gzip-base64',payload:btoa(binary)}};
 // This is the logical envelope. transportEnvelope bounds the actual
 // calculation/Agent dispatch representation before it is sent or stored.
 assert(new TextEncoder().encode(JSON.stringify(packed)).length<=16*1024*1024,413,'INPUT_LIMIT','完整计算输入超过16MiB服务预算；没有截断输入');return packed;
}

export function headKey(ctx:Context,n:string,asOf:string,snapshotId:string|null){return JSON.stringify([ctx.businessId,n,asOf,snapshotId??'']);}
