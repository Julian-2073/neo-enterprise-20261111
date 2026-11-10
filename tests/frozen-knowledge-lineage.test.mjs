import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {frozenCases,caseFixture} from '../scripts/frozen-case-fixtures.mjs';

test('real prepared knowledge requests preserve each fixture enterprise/SKU and native UTC observation before dispatch',async()=>{
 const out=await mkdtemp(path.join(tmpdir(),'neo-knowledge-lineage-'));
 try{
 execFileSync(process.execPath,['scripts/prepare-frozen-runtime.mjs','--input-version','legacy-v1','--out',out],{cwd:process.cwd(),stdio:'pipe'});
 const input=JSON.parse(await readFile(path.join(out,'inputs.json'),'utf8')),frozen=await frozenCases();assert.equal(input.frozenHash,frozen.digest);
 for(const id of ['knowledge-effective_future','knowledge-repost','knowledge-conflict']){
 const item=input.cases.find(x=>x.id===id),index=frozen.data.cases.findIndex(x=>x.id===id),fixture=caseFixture(frozen.data.cases[index],index);
 assert.equal(item.businessId,fixture.config.businessId);assert.deepEqual(item.knowledgeScope.entities,[fixture.config.entityId]);assert.equal(item.nativeDocument.document.retrievedAt,'2026-10-08T01:00:00.000Z');
 const code="import json,sys; from neo_agent.frozen_evaluation import knowledge_fixture; item=json.load(sys.stdin); print(json.dumps(knowledge_fixture(item)[0],ensure_ascii=False))";
 const job=JSON.parse(execFileSync('agent-service/.venv/bin/python',['-c',code],{cwd:process.cwd(),env:{...process.env,PYTHONPATH:'agent-service',PYTHONDONTWRITEBYTECODE:'1'},input:JSON.stringify(item),encoding:'utf8'}));
 assert.equal(job.businessId,item.businessId);assert.deepEqual(job.scope.entities,item.knowledgeScope.entities);assert.deepEqual(job.scope.channels,item.knowledgeScope.channels);assert.equal(job.document.retrievedAt,item.nativeDocument.document.retrievedAt);assert.equal(job.document.version,item.nativeDocument.document.contentHash);assert.deepEqual(job.scope.documentProvenance,item.nativeDocument.document);assert.deepEqual(job.document.paragraphs,item.nativeDocument.document.paragraphs.map(({index,text})=>({index,text})));
 }
 }finally{await rm(out,{recursive:true,force:true});}
});
