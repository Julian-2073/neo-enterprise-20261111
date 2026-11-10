import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {frozenCases,caseFixture,conversationGenerationV2} from './frozen-case-fixtures.mjs';
import {dialogueTurns} from './frozen-dialogue-turns.mjs';
import {dialogueUserStatements} from '../server/agent-conversation.ts';
import {groundDiscussion} from '../lib/grounded-dialogue.ts';
import {evaluateKnowledgeCases} from './frozen-knowledge-path.mjs';
import {scopedOperatingReviewBasis} from '../server/business-review-basis.ts';
import {stableSource} from './stable-source.mjs';
import {MATERIAL_VERSION,LEGACY_VERSION,materialPath,materialDigest,materialFixture,readKnowledgeMaterials,checkKnowledgeMechanisms,expectationCoverage} from './frozen-input-materials.mjs';
import {evaluateDialogueCases} from './frozen-dialogue-path.mjs';
import {DOCUMENT_DISPOSITION_VERSION} from '../server/document-disposition.ts';
const args=process.argv.slice(2),get=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const inputVersion=get('--input-version',MATERIAL_VERSION);
if(![MATERIAL_VERSION,LEGACY_VERSION].includes(inputVersion))throw Error('Unknown frozen input version');
const existing=get('--read-existing',null);
if(existing){
 if(inputVersion!==LEGACY_VERSION||args.includes('--out'))throw Error('Existing legacy inputs are read only and require --input-version legacy-v1');
 const saved=JSON.parse(await readFile(path.resolve(existing),'utf8')),frozen=await frozenCases();
 if(saved.frozenHash!==frozen.digest||saved.cases?.length!==60||saved.inputVersion&&saved.inputVersion!==LEGACY_VERSION)throw Error('Legacy input identity invalid');
 console.log(JSON.stringify({status:'legacy_read_only',input:path.resolve(existing),caseCount:60,providerCalls:0}));
 process.exit(0);
}
const out=path.resolve(get('--out','outputs/agent-optimization/frozen-provider-inputs-'+inputVersion+'/'+new Date().toISOString().replace(/[:.]/g,'-')));
try{await access(path.join(out,'inputs.json'));throw Error('Prepared inputs already exist; refuse overwrite');}catch(e){if(e.code!=='ENOENT')throw e;}
const {data,digest}=await frozenCases();const source=await stableSource(process.cwd());
const v2=inputVersion===MATERIAL_VERSION;
const knowledgeEvidence=v2?await Promise.all(data.cases.filter(c=>c.category==='knowledge').map(c=>readKnowledgeMaterials(c,materialFixture(c,data.cases.findIndex(x=>x.id===c.id))))):await evaluateKnowledgeCases(data.cases.filter(c=>c.category==='knowledge'));
const cases=data.cases.map((c,index)=>{
 const f=(v2?materialFixture:caseFixture)(c,c.category==='conversation'?0:index),item={id:c.id,category:c.category,context:c.context,businessId:f.config.businessId,notApplicableDimensions:c.notApplicableDimensions??[],fixtureReference:{config:'tests/fixtures/frozen-businesses.json',calculationInput:f.generation.state},unsupportedExpectations:f.fixtureComplete?[]:c.expected,expectationsForReview:c.expected,criticalForReview:c.critical};
 if(c.category==='conversation')item.unsupportedExpectations=c.expected;
 if(v2){item.inputVersion=MATERIAL_VERSION;item.unsupportedExpectations=c.expected;item.fixtureReference.materials={version:MATERIAL_VERSION,path:materialPath,sha256:materialDigest};if(Object.keys(f.supplementalRecords).length)item.fixtureReference.supplementalRecords=f.supplementalRecords;}
 if(c.category==='knowledge'){const nativeDocument=knowledgeEvidence.find(r=>r.id===c.id);return {...item,jobSequence:[],...(v2?{documentDispositionVersion:DOCUMENT_DISPOSITION_VERSION,knowledgeConfiguration:nativeDocument.configuration}:{}),knowledgeScope:{entities:[f.config.entityId],channels:[f.config.channelId],asOf:f.generation.state.asOf},knowledgeContext:c.context,nativeDocument,expectationCoverage:v2?'independent_synthetic_materials_input_available; model_semantics_NOT_COVERED':'synthetic_document_extraction_support_applicability_protocol; external_actual_source_pending'};}
 let questions=c.category==='diagnosis'?['分析以下经营问题：'+c.context]:dialogueTurns[c.id.replace('dialogue-','')];if(!questions)throw Error('Missing natural conversation input '+c.id);
 let active={};const dictionary={products:[{id:f.config.entityId,name:f.config.name}],skus:[{id:'SKU-R1'},{id:'SKU-S2'}],channels:[...new Map([{id:'douyin',name:'抖音'},{id:f.config.channelId,name:f.config.channelName}].map(x=>[x.id,x])).values()],period:{start:'2026-08-01',end:'2026-09-30'},canonical:true,scenarios:c.category==='conversation'?f.scenarios:[]};
 let previousConversation;const generationSequence=[];
 const jobSequence=questions.map((question,i)=>{
  const generation=c.id==='dialogue-version_change'&&i>0?conversationGenerationV2(f):f.generation;generationSequence.push({generationId:generation.id,version:generation.version,knownAt:generation.state.knownAt,inputRecords:generation.state.inputs.map(r=>({id:r.id,revision:r.revision,knownAt:r.knownAt})),metrics:generation.state.metrics});
  const grounding=groundDiscussion(question,dictionary);if(grounding.clarification)throw Error(c.id+': '+grounding.clarification);
  const retainedScenarios=active.scenarioIds??[];active={...active,...grounding.scope};if(grounding.scope.scenarioIds&&/比较|对比/.test(question))active.scenarioIds=[...new Set([...retainedScenarios,...grounding.scope.scenarioIds])];
  const j=structuredClone(f.job);j.id+='-turn-'+i;j.question=question;j.snapshotId=generation.id;j.envelope.snapshot.id=generation.id;j.envelope.runtimeScope.inputId=generation.id;if(c.category==='diagnosis')j.taskType='DIAGNOSE';
  j.envelope.operatingBasis=scopedOperatingReviewBasis(generation,'actual-provider',active);
  if(f.basis.researchContext)j.envelope.operatingBasis.researchContext=f.basis.researchContext;
  if(f.basis.supplementalRecords)j.envelope.operatingBasis.supplementalRecords=f.basis.supplementalRecords;
  if(f.scenarios.length){j.envelope.operatingBasis.scenarioContext=f.basis.scenarioContext;j.envelope.operatingBasis.savedRecords=f.basis.savedRecords;}
  j.envelope.operatingBasis.interaction={question,role:'joint'};
  const changed=!!previousConversation&&previousConversation.currentInputId!==generation.id;
  j.envelope.conversation={sessionId:j.sessionId,active,userStatements:dialogueUserStatements(previousConversation,question,generation.id),versionChanged:changed,invalidatedDependencies:changed?['input','metric']:[],previousInputId:previousConversation?.currentInputId??null,currentInputId:generation.id,memory:{status:'historical_context_only'},summary:[]};previousConversation=j.envelope.conversation;return j;
 });item.fixtureReference.generations=generationSequence;
 return {...item,jobSequence,expectationCoverage:c.category==='conversation'?'natural_questions_real_Runtime_with_synthetic_canonical_fixture; API_auth_scope_and_confirmation_separate_offline_gate':'distinct_structured_calculation_and_actual_DIAGNOSE_Runtime'};
});
const knowledgeMechanisms=v2?await checkKnowledgeMechanisms(cases):[];
const dialogueMechanisms=v2?await evaluateDialogueCases(data.cases.filter(c=>c.category==='conversation')):[];
const mechanismEvidence=[...knowledgeMechanisms,...dialogueMechanisms.map(({requests,...r})=>({...r,providerCalls:0}))];
if(mechanismEvidence.some(r=>r.status!=='passed')||knowledgeEvidence.some(r=>r.status!=='passed'))throw Error('Input mechanism checks failed: '+JSON.stringify(mechanismEvidence.filter(r=>r.status!=='passed')));
const coverage=v2?data.cases.map(c=>expectationCoverage(c,cases.find(i=>i.id===c.id),mechanismEvidence)):null;
await mkdir(out,{recursive:true});const input={...(v2?{inputVersion:MATERIAL_VERSION,materials:{path:materialPath,sha256:materialDigest,version:MATERIAL_VERSION},providerCalls:0,qualityGate:'pending_online_and_human_review'}:{}),frozenHash:digest,lineage:{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDigest:source.digest,executionMode:'provider_runtime_synthetic',inputPath:'tests/fixtures/frozen-businesses.json',originalAcceptanceUntouched:true},rubric:data.rubric,gate:data.gate,cases};await writeFile(path.join(out,'inputs.json'),JSON.stringify(input,null,2),{flag:'wx'});if(v2){await writeFile(path.join(out,'input-coverage.json'),JSON.stringify({version:MATERIAL_VERSION,frozenHash:digest,materialHash:materialDigest,providerCalls:0,qualityGate:'pending_online_and_human_review',priorEmptyClaims:'NOT_COVERED_preserved_in_original_receipts',mechanismEvidence,cases:coverage},null,2),{flag:'wx'});await writeFile(path.join(out,'knowledge-material-readback.json'),JSON.stringify(knowledgeEvidence,null,2),{flag:'wx'});}console.log(JSON.stringify({out,input:path.join(out,'inputs.json'),caseCount:cases.length,providerCalls:0,originalAcceptanceUntouched:true}));
