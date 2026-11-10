import assert from 'node:assert/strict';
import test from 'node:test';
import {agentPresentation,conversationalText} from '../components/neo-demo/agent-presentation.ts';
import {recordPeriodStart} from '../server/agents.ts';
test('original handoff roles preserve their action and two followups',()=>{
 assert.equal(agentPresentation.orchestrator.name,'行动编排智能体');
 assert.equal(agentPresentation.joint.name,'三智能体协作');
 for(const x of Object.values(agentPresentation))assert.equal(x.questions.length,2);
 assert.deepEqual(agentPresentation.supply.questions,['查看在途','比较调拨方案']);
});
test('long persisted reply gets a complete short sentence without rewriting history',()=>{
 const original='现有证据不能说明因果。'+ '下一步核查库存与预算。'.repeat(40);
 const brief=conversationalText(original);assert.ok(brief.length<=180);assert.match(brief,/证据不能说明因果/);assert.ok(brief.endsWith('。'));assert.ok(original.length>180);
 assert.equal(conversationalText('x'.repeat(300)),'本次研判已保存，展开查看完整判断与依据。');
});
test('reporting date belongs to Shanghai even near UTC midnight',()=>{
 assert.equal(recordPeriodStart('briefing',new Date('2026-10-03T18:00:00Z')),'2026-10-03T16:00:00.000Z');
 assert.equal(recordPeriodStart('weekly',new Date('2026-10-04T18:00:00Z')),'2026-10-04T16:00:00.000Z');
});

