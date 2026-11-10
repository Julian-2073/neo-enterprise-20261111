import {assert} from './errors.ts';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Published custom fields and historical resource envelopes retain their existing runtime validation.
type Row=Record<string,any>;
export const DOCUMENT_DISPOSITION_VERSION='document-disposition-v1';
// This metadata is descriptive only. It never produces an event or reserves a review.
export function aggregateDocumentDisposition(doc:Row,entry:Row,basis:Row){
 const paragraphs:Row[]=JSON.parse(doc.paragraphs),expected=paragraphs.map(p=>p.index),seen=new Set<number>();
 const sections=(entry.chunks as Row[][]).map((chunk,index)=>{
  const run=entry.runs?.[index],d=run?.result?.documentDisposition;
  if(!d)return {index,runId:run?.id??null,status:run?.status??'pending',paragraphIndices:chunk.map(p=>p.index),documentDisposition:null};
  assert(d.version===DOCUMENT_DISPOSITION_VERSION&&d.documentId===doc.id&&d.documentVersion===doc.content_hash&&d.sourceId===doc.source_id&&String(d.sourceVersion)===String(doc.source_version)&&d.configurationVersion===basis.configuration.version,502,'DISPOSITION','筛选理由版本错配');
  assert(['ignore','monitor','research','affects_assessment'].includes(d.classification)&&['supported','insufficient','conflict'].includes(d.supportStatus)&&typeof d.reason==='string'&&d.reason.trim()&&Array.isArray(d.gaps),502,'DISPOSITION','筛选理由格式无效');
  const indices=chunk.map(p=>p.index);
  assert(Array.isArray(d.coverage?.processedParagraphIndices)&&JSON.stringify(d.coverage.processedParagraphIndices)===JSON.stringify(indices)&&Array.isArray(d.paragraphIndices)&&d.paragraphIndices.length>0&&d.paragraphIndices.every((i:number)=>indices.includes(i)),502,'DISPOSITION','筛选理由分节覆盖错配');
  const rules=[...(basis.configuration.objectives??[]),...(basis.configuration.constraints??[])];
  for(const refs of [d.support,d.counterevidence]){
   assert(Array.isArray(refs),502,'DISPOSITION','筛选理由缺少精确引用');
   for(const ref of refs){
    if(ref.kind==='paragraph'){
     const p=chunk.find(p=>ref.id===doc.id+':paragraph:'+p.index||ref.id.startsWith(doc.id+':paragraph:'+p.index+':chars:'));
     const loc=ref.locator,exact=loc?Array.from(p?.text??'').slice(loc.start,loc.end).join(''):p?.text;
     assert(p&&ref.documentVersion===doc.content_hash&&ref.exact===exact&&(!loc||loc.sourceId===doc.id+':paragraph:'+p.index&&Number.isInteger(loc.start)&&Number.isInteger(loc.end)&&loc.start>=0&&loc.end>loc.start&&loc.end<=Array.from(p.text).length&&ref.id===loc.sourceId+':chars:'+loc.start+':'+loc.end),502,'DISPOSITION','筛选引用不是本节精确原文');
    }else assert(ref.kind==='enterprise_rule'&&rules.some(r=>r.id===ref.id&&String(r.version)===String(ref.version)&&JSON.stringify(JSON.parse(ref.exact))===JSON.stringify(r)),502,'DISPOSITION','筛选引用不是冻结的企业规则');
   }
  }
  assert(d.supportStatus!=='supported'||d.support.some((r:Row)=>r.kind==='paragraph'&&d.paragraphIndices.some((i:number)=>r.id===doc.id+':paragraph:'+i||r.id.startsWith(doc.id+':paragraph:'+i+':chars:'))),502,'DISPOSITION','有支持的筛选理由必须绑定所选原文');
  assert(d.supportStatus==='supported'||d.classification==='research',502,'DISPOSITION','未支持筛选只能待研究');
  indices.forEach(i=>{assert(!seen.has(i)&&expected.includes(i),502,'DISPOSITION','分节重复或越界');seen.add(i);});
  return {index,runId:run.id,status:run.status,paragraphIndices:indices,documentDisposition:d};
 });
 const complete=sections.every(s=>s.status==='completed'&&s.documentDisposition)&&seen.size===expected.length;
 const supported=complete&&sections.every(s=>s.documentDisposition?.supportStatus==='supported');
 const ordered=['affects_assessment','research','monitor','ignore'];
 const classification=supported?ordered.find(c=>sections.some(s=>s.documentDisposition.classification===c))!:'research';
 const counterevidence=sections.flatMap(s=>s.documentDisposition?.counterevidence??[]);
 const configurationReferences=[basis.configuration.profileReference,basis.configuration.methodReference,...sections.flatMap(s=>[...(s.documentDisposition?.support??[]),...(s.documentDisposition?.counterevidence??[])].filter(r=>r.kind==='enterprise_rule'))].filter(Boolean).map(r=>({id:r.id,version:String(r.version)}));
 return {version:DOCUMENT_DISPOSITION_VERSION,documentId:doc.id,documentVersion:doc.content_hash,sourceId:doc.source_id,sourceVersion:String(doc.source_version),configurationVersion:basis.configuration.version,configurationReferences:[...new Map(configurationReferences.map(r=>[r.id+"|"+r.version,r])).values()],classification,supportStatus:supported?'supported':sections.some(s=>s.documentDisposition?.supportStatus==='conflict')?'conflict':'insufficient',reason:supported?sections.map(s=>`第${s.index+1}节：${s.documentDisposition.reason}`).join('；'):'分节筛选理由未记录或尚未完整验证，保留待研究；各节原理由与反证见记录。',support:sections.flatMap(s=>s.documentDisposition?.support??[]),counterevidence,gaps:[...new Set([...(!complete?['document_sections_incomplete']:[]),...(sections.some(s=>s.status==='completed'&&!s.documentDisposition)?['section_disposition_not_recorded']:[]),...sections.flatMap(s=>s.documentDisposition?.gaps??[]),...(basis.configuration.gaps??[])])],coverage:{complete,processedParagraphIndices:[...seen].sort((a,b)=>a-b),expectedParagraphIndices:expected,completedSections:sections.filter(s=>s.status==='completed'&&s.documentDisposition).length,totalSections:sections.length,scope:'stored_document_paragraphs_only',policyCoverage:'not_claimed'},sections};
}
export function documentDispositionProjection(doc:Row):Row{
 const coverage=typeof doc.coverage==='string'?JSON.parse(doc.coverage):doc.coverage;
 return {...doc,coverage,documentDisposition:coverage.documentDisposition??null,dispositionStatus:coverage.documentDisposition?'recorded':'not_recorded',dispositionNotice:coverage.documentDisposition?null:'未记录筛选理由'};
}
