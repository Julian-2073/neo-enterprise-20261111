import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {groundDiscussion,localConversation} from '../lib/grounded-dialogue.ts';
import {recognizeTask} from '../server/neo-task-plan.ts';
import {currentAssessmentRun} from '../lib/assessment-presentation.ts';
import {frozenCases,caseFixture,businesses} from '../scripts/frozen-case-fixtures.mjs';
const dictionary={products:[{id:'p1',name:'跑步机'}],skus:[{id:'SKU-R1',product_id:'p1'},{id:'SKU-S2',product_id:'p1'}],channels:[{id:'douyin',name:'抖音'}],scenarios:[{id:'scenario-A',title:'方案A'}],period:{start:'2026-08-01',end:'2026-09-30'}};
test('natural UI dictionary finds authorized SKU/channel/period/scenario; ambiguous and out-of-bound turns clarify',()=>{
 assert.deepEqual(groundDiscussion('SKU-R1抖音最近四周成交多少',dictionary).scope,{entityId:'p1',skuId:'SKU-R1',channelId:'douyin',period:{start:'2026-09-03',end:'2026-09-30'}});
 assert.deepEqual(groundDiscussion('那库存呢',dictionary).scope,{});
 assert.deepEqual(groundDiscussion('改看SKU-S2',dictionary).scope,{entityId:'p1',skuId:'SKU-S2'});
 assert.deepEqual(groundDiscussion('解释方案A',dictionary).scope,{scenarioIds:['scenario-A']});
 assert.ok(groundDiscussion('SKU-R1和SKU-S2比较',dictionary).clarification);
 assert.ok(groundDiscussion('2020-01-01至2026-09-30',dictionary).clarification);
 for(const q of ['你好','您好！','谢谢','帮助']){assert.ok(localConversation(q));assert.equal(recognizeTask(q),'QUERY');}
 assert.equal(localConversation('你好，库存多少'),null);
});
test('workbench selects completed verified current full assessments across purpose; never foreign/partial/new-looking result',()=>{
 const scope={id:'s',businessId:'b',dataNature:'demo'},base={status:'completed',createdAt:'2026-10-08',result:{businessAssessment:{scope:{inputId:'s',businessId:'b',dataNature:'demo',configurationVersion:'legacy:legacy-unversioned'},context:{completeReview:true,semanticValidation:{status:'verified'}}}}};
 const full={...base,id:'current',purpose:'analysis'};assert.equal(currentAssessmentRun([{...full,id:'foreign',result:{businessAssessment:{...base.result.businessAssessment,scope:{...base.result.businessAssessment.scope,businessId:'x'}}}},full],scope).id,'current');
 assert.equal(currentAssessmentRun([{...full,status:'failed'},{...full,result:{businessAssessment:{...base.result.businessAssessment,context:{completeReview:false,semanticValidation:{status:'verified'}}}}}],scope),null);
});
test('all 60 frozen inputs run actual graph/queue/calculator; transport adapter scores stay explicitly pending',async()=>{
 const {data,digest}=await frozenCases();assert.equal(digest,'832f078da40fff0751e9f1bc18d69f56e0d2960e4b7e6555fe148ade31c611f7');assert.equal(businesses.length,6);assert.equal(new Set(businesses.map(b=>b.businessId)).size,6);
 for(const [i,c] of data.cases.entries()){const f=caseFixture(c,i);assert.equal(f.generation.state.businessId,f.config.businessId);for(const [name,pass] of Object.entries(f.oracles))assert.equal(pass,true,c.id+'/'+name);for(const [key,expected] of Object.entries(c.numericAnchors??{}))assert.equal(f.observed[key],expected,c.id+'/'+key);}
 const run=spawnSync(process.execPath,['scripts/evaluate-frozen-cases.mjs'],{encoding:'utf8',maxBuffer:2000000});assert.equal(run.status,0,run.stdout+run.stderr);const receipt=JSON.parse(run.stdout.trim().split('\n').at(-1));assert.equal(receipt.runtimeCompleted,44);assert.equal(receipt.apiCasesPassed,15);assert.equal(receipt.casesExecuted,60);assert.equal(receipt.scopeFailures,0);assert.equal(receipt.meanScore,null);assert.equal(receipt.qualityGate,'pending_online_and_human_review');
});
test('normal default gate includes Python and preserves build/render; acceptance wrapper points at original restored state',async()=>{
 const p=JSON.parse(await readFile('package.json'));assert.match(p.scripts.test,/test:python/);assert.match(p.scripts.test,/test:node/);assert.match(p.scripts.test,/npm run build/);assert.match(p.scripts['start:acceptance'],/outputs\/backend-closure\/prior-data/);assert.doesNotMatch(p.scripts['start:acceptance'],/setup:local/);
});


test('negative review instruction does not promote factual queries',()=>{
 assert.equal(recognizeTask('当前统计期间支付订单和退款各有多少笔？不要进行完整研判。'),'QUERY');
 assert.equal(recognizeTask('不要分析原因，只查询退款笔数'),'QUERY');
 assert.equal(recognizeTask('查看在途'),'QUERY');
 assert.equal(recognizeTask('比较调拨方案'),'SIMULATE');
 assert.equal(recognizeTask('不要预测销量，综合审查目前经营问题'),'REVIEW');
});
