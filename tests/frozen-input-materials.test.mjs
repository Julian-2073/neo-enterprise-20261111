import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {frozenCases,caseFixture} from '../scripts/frozen-case-fixtures.mjs';
import {MATERIAL_VERSION,materialDigest,materialFixture} from '../scripts/frozen-input-materials.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const pythonJob=item=>JSON.parse(execFileSync('agent-service/.venv/bin/python',['-c','import json,sys; from neo_agent.frozen_evaluation import knowledge_fixture; print(json.dumps(knowledge_fixture(json.load(sys.stdin))[0],ensure_ascii=False))'],{encoding:'utf8',input:JSON.stringify(item),stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONPATH:'agent-service',PYTHONDONTWRITEBYTECODE:'1',LLM_API_KEY:''}}));

test('default v2 prepares all frozen cases with exact independent sources, unknown profile and review-only coverage',async()=>{
 const out=await mkdtemp(path.join(tmpdir(),'neo-materials-v2-'));
 try{
  execFileSync(process.execPath,['scripts/prepare-frozen-runtime.mjs','--out',out],{stdio:'pipe',env:{...process.env,LLM_API_KEY:'',NEO_MARKET_PROVIDER:'disabled'}});
  const input=JSON.parse(await readFile(path.join(out,'inputs.json'),'utf8')),coverage=JSON.parse(await readFile(path.join(out,'input-coverage.json'),'utf8')),{data,digest}=await frozenCases();
  assert.equal(input.inputVersion,MATERIAL_VERSION);assert.equal(input.materials.sha256,materialDigest);assert.equal(input.frozenHash,digest);assert.equal(input.cases.length,60);assert.equal(input.providerCalls,0);assert.equal(coverage.providerCalls,0);
  assert.equal(input.cases.filter(c=>c.category==='diagnosis').length,30);assert.equal(input.cases.filter(c=>c.category==='conversation').length,15);
  for(const c of input.cases)assert.ok(c.fixtureReference.calculationInput.inputs.every(r=>r.knownAt<=c.fixtureReference.calculationInput.knownAt));
  assert.equal(coverage.cases.flatMap(c=>c.expected).length,data.cases.flatMap(c=>c.expected).length);
  for(const row of coverage.cases){assert.deepEqual(row.expected.map(e=>e.expected),data.cases.find(c=>c.id===row.id).expected);assert.ok(row.expected.every(e=>e.semanticStatus==='NOT_COVERED'&&e.human==='pending'));}
  assert.ok(coverage.mechanismEvidence.every(r=>r.status==='passed'&&r.providerCalls===0));
  for(const c of input.cases.filter(c=>c.category==='knowledge'&&c.nativeDocument.document)){
   const job=pythonJob(c);assert.equal(job.documentDispositionVersion,'document-disposition-v1');assert.equal(job.businessId,c.businessId);assert.deepEqual(job.scope.entities,c.knowledgeScope.entities);assert.equal(job.document.retrievedAt,'2026-10-08T01:00:00.000Z');
   assert.equal(job.document.version,c.nativeDocument.document.contentHash);assert.equal(job.scope.sourceProvenance.length,c.nativeDocument.sources.length);
   assert.equal(job.document.paragraphs.length,job.scope.paragraphLocators.length);
   for(const locator of job.scope.paragraphLocators){const source=c.nativeDocument.sources.find(s=>s.id===locator.sourceId),paragraph=source.document.paragraphs.find(p=>p.index===locator.sourceParagraphIndex);assert.equal(job.document.paragraphs[locator.paragraphIndex].text,paragraph.text);assert.equal(locator.sourceContentHash,source.document.contentHash);}
   const serialized=JSON.stringify(job);for(const field of ['expectationsForReview','criticalForReview','unsupportedExpectations','numericAnchors','oracles','rubric','scores'])assert.ok(!serialized.includes('"'+field+'"'));
  }
  const unknown=input.cases.find(c=>c.id==='knowledge-scope_unknown'),uj=pythonJob(unknown);assert.equal(unknown.fixtureReference.calculationInput.profile.region,'');assert.equal(uj.configuration.region,null);assert.equal(uj.configuration.registeredEmployees,null);assert.equal(uj.configuration.objectives[0].statement.region,null);
  const candidate=pythonJob(input.cases.find(c=>c.id==='knowledge-memory_candidate'));assert.equal(candidate.configuration.constraints.length,0);assert.equal(candidate.scope.contextRecords.candidates[0].state,'candidate');assert.equal(candidate.scope.contextRecords.candidates[0].confirmedBy,null);
  const conflict=input.cases.find(c=>c.id==='knowledge-conflict');assert.equal(conflict.nativeDocument.sources.length,2);assert.notEqual(...conflict.nativeDocument.sources.map(s=>s.contentHash));assert.match(conflict.nativeDocument.document.rawText,/不超过20人/);assert.match(conflict.nativeDocument.document.rawText,/不超过50人/);assert.equal(conflict.nativeDocument.sourceRelations[0].kind,'summary_of');assert.match(conflict.nativeDocument.sources[1].document.rawText,/标题 合成媒体政策摘要/);
  const repost=input.cases.find(c=>c.id==='knowledge-repost');assert.equal(repost.nativeDocument.sources.length,4);assert.equal(new Set(repost.nativeDocument.sources.map(s=>s.contentHash)).size,1);assert.equal(repost.nativeDocument.sourceRelations.length,3);
  for(const [id,date] of [['knowledge-effective_future','2026年11月1日'],['knowledge-expired','2026年10月7日']])assert.ok(input.cases.find(c=>c.id===id).nativeDocument.document.rawText.includes(date));
  const unreadable=input.cases.find(c=>c.id==='knowledge-unreadable');assert.equal(unreadable.nativeDocument.document,null);assert.throws(()=>pythonJob(unreadable));
  const scenarios=input.cases.find(c=>c.id==='dialogue-scenario_hold');assert.ok(scenarios.jobSequence.every(j=>j.envelope.operatingBasis.savedRecords.fullRecords.every(r=>r.generationId===j.snapshotId&&r.executionStatus==='not_executed')));
  const prepared=await readFile(path.join(out,'inputs.json'));assert.throws(()=>execFileSync(process.execPath,['scripts/prepare-frozen-runtime.mjs','--out',out],{stdio:'pipe'}));assert.equal(hash(await readFile(path.join(out,'inputs.json'))),hash(prepared));
 }finally{await rm(out,{recursive:true,force:true});}
});

test('explicit legacy preparation and read-only recovery preserve unmarked jobs and original fixture bytes',async()=>{
 const out=await mkdtemp(path.join(tmpdir(),'neo-materials-legacy-'));
 try{
  execFileSync(process.execPath,['scripts/prepare-frozen-runtime.mjs','--input-version','legacy-v1','--out',out],{stdio:'pipe'});
  const inputBytes=await readFile(path.join(out,'inputs.json')),input=JSON.parse(inputBytes);assert.equal(input.inputVersion,undefined);
  const item=input.cases.find(c=>c.id==='knowledge-effective_future'),job=pythonJob(item);assert.equal(job.documentDispositionVersion,undefined);assert.equal(job.id,'frozen-knowledge-effective_future');
  const {data}=await frozenCases(),original=data.cases.find(c=>c.id==='knowledge-scope_unknown'),index=data.cases.findIndex(c=>c.id===original.id);assert.equal(caseFixture(original,index).generation.state.profile.region,'杭州');assert.equal(materialFixture(original,index).generation.state.profile.region,'');assert.equal(caseFixture(original,index).generation.state.profile.region,'杭州');
  const output=JSON.parse(execFileSync(process.execPath,['scripts/prepare-frozen-runtime.mjs','--input-version','legacy-v1','--read-existing',path.join(out,'inputs.json')],{encoding:'utf8'}));assert.equal(output.status,'legacy_read_only');assert.deepEqual(await readFile(path.join(out,'inputs.json')),inputBytes);
 }finally{await rm(out,{recursive:true,force:true});}
});
