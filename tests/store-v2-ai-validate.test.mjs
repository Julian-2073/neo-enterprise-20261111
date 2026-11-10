import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateInvestigationResult, validateHypothesis} from '../lib/store-v2/ai/validate.ts';
import {MockAIProvider} from '../lib/store-v2/ai/provider.ts';

test('mock provider output passes structural + semantic validation', async () => {
  const p = new MockAIProvider();
  const out = await p.investigate({case_id: 'c1', context: 'out_of_stock signal', budget: {max_tokens: 1000, max_steps: 3}});
  const validated = validateInvestigationResult(out);
  assert.equal(validated.hypotheses.length, 1);
  assert.ok(validated.hypotheses[0].evidence_refs.length > 0);
  assert.equal(validated.provider, undefined);
});

test('validation rejects a claim containing a money amount', () => {
  const issues = validateHypothesis({claim: '损失约 120000 元', confidence: 0.9, evidence_refs: ['s1']}, 0);
  assert.ok(issues.some((i) => i.message.includes('金额')), JSON.stringify(issues));
});

test('validation rejects a claim containing an approval directive', () => {
  const issues = validateHypothesis({claim: '建议审批通过并写回 ERP', confidence: 0.9, evidence_refs: ['s1']}, 0);
  assert.ok(issues.some((i) => i.message.includes('审批') || i.message.includes('写回')), JSON.stringify(issues));
});

test('validation rejects a hypothesis without evidence refs', () => {
  const issues = validateHypothesis({claim: '缺货', confidence: 0.5, evidence_refs: []}, 0);
  assert.ok(issues.some((i) => i.field.endsWith('evidence_refs')));
});

test('validateInvestigationResult throws on forbidden summary', () => {
  assert.throws(() => validateInvestigationResult({
    case_id: 'c1', summary: '请审批并执行 SQL 更新', hypotheses: [],
  }), (err) => err && err.code === 'INVALID_AI_OUTPUT');
});
