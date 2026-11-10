import type {Context} from '../auth.ts';
import {assert} from '../errors.ts';
import {first,statement} from '../store.ts';
import {scalarValue} from './model.ts';
import {project} from './project.ts';
import {buildData,readBuildInput,createBuild,headKey,nature,now,text} from './store.ts';
export async function prepareEdit(ctx:Context,input:Record<string,unknown>,runId='preview'){
 const data=await buildData(ctx,input.buildId,nature(input.dataNature)),property=text(input.property,'property');
 const type=data.definition.types.find(t=>t.id===input.typeId),object=data.objects.find(o=>o.typeId===input.typeId&&o.id===input.objectId);
 assert(type&&object,404,'NOT_FOUND','对象不存在');assert(type.properties[property]?.mode==='editable',422,'NOT_EDITABLE','原始或计算属性不能直接编辑');
 const value=scalarValue(input.value,type.properties[property]);
 if(type.id==='inventory'&&property==='safetyUnits')assert(value===null||typeof value==='number'&&value>=0,422,'BUSINESS_CONDITION','安全库存不能小于零');
 const key=headKey(ctx,data.build.data_nature,data.build.as_of,data.build.snapshot_id);
 const head=await first<{build_id:string}>(ctx.db,'SELECT build_id FROM ontology_heads WHERE id=?',key);
 const latest=head?.build_id??(await first<{id:string}>(ctx.db,"SELECT id FROM ontology_builds WHERE business_id=? AND data_nature=? AND as_of=? AND COALESCE(snapshot_id,generation_id,'')=COALESCE(?,'') AND status IN ('ready','partial') ORDER BY created_at DESC,id DESC LIMIT 1",ctx.businessId,input.dataNature,data.build.as_of,data.build.snapshot_id))?.id;
 assert(latest===data.build.id,409,'VERSION_CONFLICT','对象已有更新，请切换最新投影');
 const at=now(),editId='edit-'+runId,captured=await readBuildInput(data.build);
 captured.edits=[...(captured.edits??[]),{id:editId,typeId:object.typeId,objectId:object.id,property,value,availableAt:at}];
 const projection=project(captured,data.definition,data.build.as_of);
 const oldLinks=new Set(data.links.map(l=>JSON.stringify([l.linkId,l.fromId,l.toId]))),nextLinks=new Set(projection.links.map(l=>JSON.stringify([l.linkId,l.fromId,l.toId])));
 const preview={action:'edit_property',valid:!projection.issues.some(i=>i.severity==='error'),changes:{typeId:object.typeId,objectId:object.id,property,before:object.properties[property]??null,after:value},proposedChanges:{objects:[{typeId:object.typeId,id:object.id,property,before:object.properties[property]??null,after:value}],links:{added:[...nextLinks].filter(x=>!oldLinks.has(x)).map(x=>JSON.parse(x)),removed:[...oldLinks].filter(x=>!nextLinks.has(x)).map(x=>JSON.parse(x))}},conditions:[{id:'editable_and_current',passed:true}],issues:projection.issues,warning:'提交前重新校验；只有成功发布的编辑才会生效'};
 return {data,key,at,editId,captured,projection,preview};
}
export async function commitEdit(ctx:Context,input:Record<string,unknown>,runId:string,trace:Array<Record<string,unknown>>){
 const p=await prepareEdit(ctx,input,runId);assert(p.preview.valid,422,'PROJECTION_FAILED','编辑违反对象或关系约束；请查看预览问题');
 const {data,key,at,editId}=p;let candidate:string|undefined;
 await statement(ctx.db,'INSERT OR IGNORE INTO ontology_heads(id,build_id,updated_at) VALUES(?,?,?)',key,data.build.id,at).run();
 const inserted=await statement(ctx.db,"INSERT OR IGNORE INTO ontology_edits(id,business_id,data_nature,type_id,object_id,property,base_build_id,value,previous_value,actor_id,created_at,status,run_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,'staged',?)",editId,ctx.businessId,input.dataNature,input.typeId,input.objectId,input.property,data.build.id,JSON.stringify(p.preview.changes.after),JSON.stringify(p.preview.changes.before),ctx.userId,at,runId).run();
 assert(inserted.meta.changes===1,409,'VERSION_CONFLICT','该投影正在编辑或已有更新，请刷新');
 try{
  const built=await createBuild(ctx,input,{data:p.captured,definition:data.definition,nature:nature(input.dataNature),asOf:data.build.as_of,knownAt:at,snapshotId:data.build.snapshot_id},true);candidate=built.id;
  assert(built.status!=='failed',422,'PROJECTION_FAILED','候选投影失败');const result={...built,status:p.projection.issues.length?'partial':'ready'};
  trace.push({step:'projection_publish',at:now(),status:'completed',buildId:result.id,inputRef:data.build.id,outputRef:result.id});
  await ctx.db.batch([
   statement(ctx.db,'UPDATE ontology_heads SET build_id=?,updated_at=? WHERE id=? AND build_id=?',result.id,at,key,data.build.id),
   statement(ctx.db,"UPDATE ontology_edits SET status='committed',result_build_id=? WHERE id=? AND EXISTS(SELECT 1 FROM ontology_heads WHERE id=? AND build_id=?)",result.id,editId,key,result.id),
   statement(ctx.db,"UPDATE ontology_builds SET status=? WHERE id=? AND EXISTS(SELECT 1 FROM ontology_edits WHERE id=? AND status='committed')",result.status,result.id,editId),
   statement(ctx.db,"UPDATE ontology_runs SET status='completed',result=?,trace=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM ontology_edits WHERE id=? AND status='committed')",JSON.stringify(result),JSON.stringify(trace),at,runId,editId),
  ]);
  const saved=await first<{status:string}>(ctx.db,'SELECT status FROM ontology_edits WHERE id=?',editId);assert(saved?.status==='committed',409,'VERSION_CONFLICT','提交期间版本已变化，请重新预览');
  return result;
 }catch(e){
  await statement(ctx.db,"UPDATE ontology_edits SET status='rejected' WHERE id=? AND status='staged'",editId).run();
  if(candidate)await statement(ctx.db,"UPDATE ontology_builds SET status='failed' WHERE id=? AND status='building'",candidate).run();throw e;
 }
}
