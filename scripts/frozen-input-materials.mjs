import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {caseFixture} from './frozen-case-fixtures.mjs';
import {buildBusinessState} from '../lib/business-state.ts';
import {calculateScenario} from '../lib/business-scenarios.ts';
import {operatingReviewBasis} from '../server/business-review-basis.ts';
import {readKnowledgeDocument,enqueueSource} from '../server/knowledge.ts';
import {processMonitorTask} from '../server/knowledge-monitor.ts';
import {localRuntime} from './local-runtime.mjs';
import {DOCUMENT_DISPOSITION_VERSION} from '../server/document-disposition.ts';

export const MATERIAL_VERSION='frozen-input-materials-v2';
export const LEGACY_VERSION='legacy-v1';
export const materialPath='tests/fixtures/frozen-input-materials-v2.json';
const bytes=await readFile(new URL('../'+materialPath,import.meta.url));
export const materialDigest=createHash('sha256').update(bytes).digest('hex');
const materials=JSON.parse(bytes);
if(materials.version!==MATERIAL_VERSION)throw Error('Unexpected input material version');
const digest=value=>createHash('sha256').update(value).digest('hex');
const htmlEscape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const substitute=(value,f)=>JSON.parse(JSON.stringify(value).replaceAll('{entityId}',f.config.entityId).replaceAll('{productName}',f.config.name));

/** Copy the original calculation fixture; supplements never mutate the frozen labels or legacy records. */
export function materialFixture(c,index){
 const f=caseFixture(c,index),detail=materials.knowledge[c.id];
 const supplemental=substitute(materials.supplements[c.id]??{},f),g=structuredClone(f.generation);
 if(detail)g.state.profile.region=detail.confirmed.region??'';
 const additions=(supplemental.addRecords??[]).map((r,i)=>({id:c.id+'-v2-record-'+i,recordKey:'v2-row-'+i,sourceId:'fixture-erp',revision:1,knownAt:f.generation.state.knownAt,entityId:f.config.entityId,channelId:f.config.channelId,...r}));
 delete supplemental.addRecords;
 g.version=MATERIAL_VERSION;g.id+='-materials-v2';
 g.state=buildBusinessState({...g.state,profileVersion:g.state.profileVersion+'-materials-v2',start:g.state.period.start,end:g.state.period.end},[...g.state.inputs,...additions],g.state.coverage);
 g.baseline=calculateScenario(g.state,{id:'baseline',name:'维持当前已登记条件',demandBps:10000,actions:[]},g.id);
 const basis=operatingReviewBasis(g,'prepared-provider-identity');basis.interaction={question:c.context,role:'joint'};
 if(Object.keys(supplemental).length)basis.supplementalRecords={version:MATERIAL_VERSION,dataLabel:'SYNTHETIC_DEMO',records:supplemental};
 if(f.basis.researchContext){basis.researchContext=structuredClone(f.basis.researchContext);delete basis.researchContext.enterpriseApplicability;}
 const scenarios=structuredClone(f.scenarios).map(s=>({...s,baselineId:g.id,result:calculateScenario(g.state,s.parameters,g.id)}));
 if(scenarios.length){
  basis.scenarioContext={generationId:g.id,scenarios,results:scenarios.map(s=>s.result)};
  const fullRecords=scenarios.map(s=>({id:s.id,kind:'scenario',businessId:f.config.businessId,dataNature:'demo',generationId:g.id,parameters:s.parameters,results:[s.result],executionStatus:'not_executed',createdAt:materials.observationAt}));
  basis.savedRecords={businessId:f.config.businessId,dataNature:'demo',generationId:g.id,records:fullRecords,fullRecords,truncated:false,registryHash:digest(JSON.stringify(fullRecords))};
 }
 return {...f,generation:g,basis,scenarios,supplementalRecords:supplemental,materialVersion:MATERIAL_VERSION,job:{...structuredClone(f.job),id:f.job.id+'-materials-v2',snapshotId:g.id,envelope:{...structuredClone(f.job.envelope),snapshot:{...f.job.envelope.snapshot,id:g.id},operatingBasis:basis,runtimeScope:{...f.job.envelope.runtimeScope,inputId:g.id}}}};
}

export function knowledgeMaterial(c,f){
 const material=substitute(materials.knowledge[c.id],f);
 if(!material)throw Error('Missing independent material '+c.id);
 const profile={businessId:f.config.businessId,dataNature:'demo',region:material.confirmed.region,registeredEmployees:material.confirmed.registeredEmployees,products:[{entityId:f.config.entityId,name:f.config.name,productCategory:'室内固定式电动跑步机'}]};
 const reference={id:'profile:'+c.id+'-materials-v2',version:materialDigest};
 const objective={id:'objective:'+c.id+'-v2',version:materialDigest,kind:'objective',statement:{businessId:f.config.businessId,entityId:f.config.entityId,focus:'经营产品的登记与合规要求'}};
 const constraints=c.id==='knowledge-impact'?[{id:'compliance:'+c.id+'-v2',version:materialDigest,kind:'compliance',statement:{entityId:f.config.entityId,productCategory:'室内固定式电动跑步机',requiredRecords:['紧急停止装置测试记录']},confirmedBy:'synthetic-owner',confirmedAt:'2026-10-08T00:00:00.000Z'}]:[];
 return {material,configuration:{version:2,profileReference:reference,region:profile.region,registeredEmployees:profile.registeredEmployees,competitors:material.confirmed.competitors??[],objectives:[{...reference,kind:'objective',statement:profile},objective],constraints,evaluationAt:materials.observationAt,evaluationTimezone:'Asia/Shanghai',dataLabel:'SYNTHETIC_DEMO',gaps:[...(!profile.region?['enterprise_region_unknown']:[]),...(profile.registeredEmployees===null?['enterprise_registered_scale_unknown']:[])]}};
}

function sourceBody(source,material,navigation='观察版本1'){
 if(material.unreadable)return '<html><form><input type="password">登录后访问</form></html>';
 const canonical=source.kind==='synthetic_repost'?(material.sources.find(s=>s.id===source.originalId)??source):source;
 const meta=`合成原件元信息：标题 ${canonical.title}；发布方 ${canonical.issuer}；原件编号 ${canonical.originalId}；发布状态 ${canonical.publicationStatus}；发布日期 ${canonical.publishedAt??'未列明'}。`;
 const body=[meta,...source.paragraphs].map(p=>'<p>'+htmlEscape(p)+'</p>').join('');
 return `<html><head>${source.publishedAt?'<meta name="PubDate" content="'+htmlEscape(source.publishedAt)+'">':''}</head><body><nav>${navigation}</nav><main>${body}</main></body></html>`;
}

/** Each source is independently read by the production reader using an isolated HTTP body. No external fetch or model. */
export async function readKnowledgeMaterials(c,f){
 const {material,configuration}=knowledgeMaterial(c,f),now=new Date(materials.observationAt),sources=[],assertions=[];
 const check=(name,passed)=>assertions.push({name,passed:!!passed});
 for(const source of material.sources){
  const body=sourceBody(source,material),host=new URL(source.url).hostname;
  try{const document=await readKnowledgeDocument(source.url,now,async()=>new Response(body,{headers:{'content-type':'text/html'}}),[host]);
   sources.push({...source,body,document,contentHash:document.contentHash,retrievedAt:document.retrievedAt});
   check(source.id+':native_read_metadata',document.publishedAt===source.publishedAt&&document.retrievedAt===materials.observationAt&&document.coverage.kind==='current_observation');
  }catch(e){if(!material.unreadable)throw e;sources.push({...source,body,document:null,readError:String(e)});check('unreadable_blocks_document',true);}
 }
 if(material.observations){const first=sources[0],second=await readKnowledgeDocument(first.url,new Date(material.observations[1]),async()=>new Response(sourceBody(first,material,'观察版本2'),{headers:{'content-type':'text/html'}}),[new URL(first.url).hostname]);check('body_hash_ignores_navigation',first.document.contentHash===second.contentHash);first.repeatObservation=second;}
 const paragraphs=[],locators=[];
 for(const source of sources.filter(s=>s.document))for(const p of source.document.paragraphs){const index=paragraphs.length;paragraphs.push({...p,index});locators.push({paragraphIndex:index,sourceId:source.id,sourceVersion:source.version,sourceContentHash:source.contentHash,sourceParagraphIndex:p.index,sourceParagraphHash:p.hash});}
 const rawText=paragraphs.map(p=>p.text).join('\n');let offset=0;for(const p of paragraphs){p.start=offset;p.end=offset+p.text.length;offset=p.end+1;}
 const document=paragraphs.length?{id:'document-'+c.id+'-materials-v2',sourceId:'material-bundle-'+c.id,sourceVersion:2,originalId:'synthetic-bundle-'+c.id,rawText,paragraphs,contentHash:digest(rawText),publishedAt:sources.length===1?sources[0].document.publishedAt:null,retrievedAt:materials.observationAt,coverage:{kind:'current_observation',actualStart:null,actualEnd:null,bodyScope:'independently_read_source_bundle',gaps:['synthetic_material_not_real_publication','current_page_cannot_prove_historical_coverage']}}:null;
 check('source_locator_complete',locators.length===paragraphs.length);
 return {id:c.id,materialVersion:MATERIAL_VERSION,materialHash:materialDigest,dataLabel:'SYNTHETIC_DEMO',source:'isolated_synthetic_HTTP_body_not_external_publication',sources,sourceRelations:material.relations??[],paragraphLocators:locators,document,configuration,contextRecords:{inquiry:material.inquiry??null,productRecords:material.productRecords??[],candidates:material.candidates??[]},assertions,status:assertions.every(a=>a.passed)?'passed':'failed',providerCalls:0};
}

/** The queue/dedupe path uses synthetic completed/queued adapters, not semantic model quality. */
export async function checkKnowledgeMechanisms(items){
 const {mf,runtime}=await localRuntime(),out=[];
 try{for(const item of items.filter(i=>['knowledge-repost','knowledge-unchanged','knowledge-unreadable'].includes(i.id))){
  const now=new Date(materials.observationAt),business=item.businessId,ctx={db:runtime.DB,runtime,businessId:business,businessName:'隔离合成企业',userId:'synthetic-owner',role:'admin'};
  await runtime.DB.prepare('INSERT OR IGNORE INTO businesses(id,name) VALUES(?,?)').bind(business,'隔离合成企业').run();
  const snapshot={id:item.id+'-mechanism-snapshot',businessId:business,dataNature:'demo',asOf:item.knowledgeScope.asOf,domain:{products:item.knowledgeScope.entities.map(id=>({id}))},data:{inventory:[],financial:{}},evidenceIds:{}};
  await runtime.DB.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(snapshot.id,business,'demo',now.toISOString(),JSON.stringify(snapshot)).run();
  const native=item.nativeDocument,dispatches=[],bodies=new Map(native.sources.map(s=>[s.url,s.body]));
  const deps={read:readKnowledgeDocument,service:async(_ctx,route,job)=>{
   if(route==='/knowledge-source')return {body:bodies.get(job.url),contentType:'text/html'};
   if(route==='/knowledge-runs'){dispatches.push(job);if(item.id!=='knowledge-unchanged')return {id:job.id,status:'queued'};
    // Explicit deterministic transport result only allows testing unchanged-work guard.
    return {id:job.id,status:'completed',result:{documentId:job.document.id,documentVersion:job.document.version,claims:[],semanticValidation:{status:'verified'},documentDisposition:{version:DOCUMENT_DISPOSITION_VERSION,documentId:job.document.id,documentVersion:job.document.version,sourceId:job.document.sourceId,sourceVersion:String(job.document.sourceVersion),configurationVersion:job.configuration.version,configurationReferences:[],classification:'research',paragraphIndices:[job.document.paragraphs[0].index],reason:'合成离线传输夹具；模型语义未评。',supportStatus:'insufficient',support:[],counterevidence:[],gaps:['offline_transport_only'],coverage:{processedParagraphIndices:job.document.paragraphs.map(p=>p.index),paragraphCount:job.document.paragraphs.length,scope:'provided_section_only'}}}};
   }throw Error('Unexpected offline route '+route);
  }};
  const statuses=[];let firstSource;
  for(const s of native.sources){const source={id:item.id+'-'+s.id,url:s.url,title:s.title,version:s.version,payload:JSON.stringify({pages:[],allowedHosts:[new URL(s.url).hostname],originalId:s.originalId})};firstSource??=source;
   await runtime.DB.prepare('INSERT INTO neo_knowledge_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(source.id,business,'demo',source.url,source.title,'policy',1,source.version,source.payload,'synthetic-owner',now.toISOString(),now.toISOString()).run();
   const task=await enqueueSource(ctx,'demo',source,'v2-'+s.id,now,true);await processMonitorTask(ctx,await runtime.DB.prepare('SELECT * FROM neo_monitor_tasks WHERE id=?').bind(task.id).first(),deps,now);
   statuses.push(await runtime.DB.prepare('SELECT status,payload FROM neo_monitor_tasks WHERE id=?').bind(task.id).first());
  }
  const assertions=[];const check=(name,passed)=>assertions.push({name,passed:!!passed});
  if(item.id==='knowledge-repost'){check('reposts_one_canonical_document_and_job',dispatches.length===4&&new Set(dispatches.map(j=>j.document.id)).size===1&&new Set(dispatches.map(j=>j.id)).size===1);check('queued_not_published',Number((await runtime.DB.prepare('SELECT COUNT(*) n FROM neo_knowledge_events WHERE business_id=?').bind(business).first()).n)===0);}
  if(item.id==='knowledge-unreadable'){check('unreadable_no_extraction_queue',dispatches.length===0&&statuses.every(t=>t.status==='failed'));}
  if(item.id==='knowledge-unchanged'){const stamp=new Date('2026-10-09T01:00:00.000Z'),before=dispatches.length;const task=await enqueueSource(ctx,'demo',firstSource,'v2-repeat',stamp,true);await processMonitorTask(ctx,await runtime.DB.prepare('SELECT * FROM neo_monitor_tasks WHERE id=?').bind(task.id).first(),deps,stamp);const saved=await runtime.DB.prepare('SELECT status,payload FROM neo_monitor_tasks WHERE id=?').bind(task.id).first();check('unchanged_no_new_dispatch',saved.status==='completed'&&dispatches.length===before&&JSON.parse(saved.payload).documents.every(d=>d.unchanged));}
  out.push({id:item.id,track:'production_reader_dedupe_queue_with_offline_transport',assertions,status:assertions.every(a=>a.passed)?'passed':'failed',providerCalls:0,semanticQuality:'NOT_COVERED'});
 }}finally{await mf.dispose();}return out;
}

const mechanismCases=new Set(['knowledge-unreadable','knowledge-unchanged','knowledge-repost','dialogue-tenant_deny','dialogue-nature_deny','dialogue-permission_deny','dialogue-confirm_rule','dialogue-query_routing']);
/** Review-only expectations remain separate from provider jobs; input presence never sets a semantic pass. */
export function expectationCoverage(c,item,mechanisms=[]){
 const mechanism=mechanisms.find(r=>r.id===c.id),mechanismTrack=mechanismCases.has(c.id);
 return {id:c.id,materialVersion:MATERIAL_VERSION,expected:c.expected.map((expected,index)=>({index,expected,coverageType:mechanismTrack?'mechanism':'model-semantic',inputStatus:'available',inputReferences:c.category==='knowledge'?item.nativeDocument.sources.map(s=>({id:s.id,version:s.version,contentHash:s.contentHash??null})):['fixtureReference.calculationInput','jobSequence.envelope.operatingBasis',...(item.fixtureReference?.supplementalRecords?['fixtureReference.supplementalRecords']:[])],mechanismStatus:mechanism?mechanism.status:mechanismTrack?'pending_separate_API_gate':'not_applicable',semanticStatus:'NOT_COVERED',online:'not_executed',human:'pending'})),scores:null,qualityGate:'pending_online_and_human_review'};
}
