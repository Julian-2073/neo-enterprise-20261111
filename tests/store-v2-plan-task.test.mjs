import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleStoreV2} from '../server/v2/router.ts';

let runtime, mf;
before(async () => { ({mf, runtime} = await localRuntime()); });
after(async () => { await mf?.dispose(); });

function req(path, {method = 'GET', body, headers = {}, workspace = 'test-a', qs = ''} = {}) {
  const q = `?businessId=${workspace}${qs ? '&' + qs : ''}`;
  return new Request(`http://localhost/api/v2/store/${path}${q}`, {
    method,
    headers: {origin: 'http://localhost', ...(body ? {'Content-Type': 'application/json', 'Idempotency-Key': 'key-12345678'} : {}), ...headers},
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function call(path, opt) {
  const r = await handleStoreV2(req(path, opt), runtime);
  return {status: r.status, data: await r.json()};
}

const stockInput = (storeId) => ({
  schema_version: 'neo.store-input.v2', data_kind: 'synthetic', grain: 'order_line',
  store_id: storeId, source_system: 'pos', source_semantics_version: 'v1',
  currency: 'CNY', tax_basis: 'tax_inclusive', business_timezone: 'Asia/Shanghai',
  as_of: '2026-10-20T00:00:00Z',
  domain_coverage: [{domain: 'stock', event_start: '2026-10-20T00:00:00+08:00', event_end: '2026-10-20T23:59:59+08:00', completeness: 'complete', declaration_ref: 'd1'}],
  skus: [{source_sku_id: 'Z1-40', style_id: 'Z1', style_color_id: 'Z1-BLK', name: 'Z1 40', category: '鞋', color: '黑', size_code: '40', size_system: 'EU', unit: 'pair', role: 'core'}],
  sales: [], returns: [], stock: [{source_sku_id: 'Z1-40', recorded_at: '2026-10-20T00:00:00+08:00', available_quantity: 0, reserved_quantity: 0, in_transit_quantity: 0, physical_quantity: 0}],
  campaigns: [], campaign_links: [],
});

async function makeCase(storeId, ik) {
  const staged = await call('imports', {method: 'POST', body: stockInput(storeId), headers: {'Idempotency-Key': ik}});
  const confirm = await call(`imports/${staged.data.import_id}/confirm`, {method: 'POST', body: {validation_revision: staged.data.validation_revision}, headers: {'Idempotency-Key': ik + 'c'}});
  const det = await call('signals/detect', {method: 'POST', body: {snapshot_id: confirm.data.snapshot_id}, headers: {'Idempotency-Key': ik + 'd'}});
  return det.data.case;
}

test('plan revision lifecycle: draft -> submitted -> approved, frozen hash', async () => {
  const c = await makeCase('ws-pl1', 'pl1-12345678');
  const plan = await call(`cases/${c.case_id}/plans`, {method: 'POST', body: {title: '补货计划', payload: {actions: ['order 20 pairs']}}, headers: {'Idempotency-Key': 'pl1p-12345678'}});
  assert.equal(plan.data.state, 'draft');

  const submitted = await call(`plans/${plan.data.plan_revision_id}/submit`, {method: 'POST', body: {expected_version: plan.data.version}, headers: {'Idempotency-Key': 'pl1s-12345678'}});
  assert.equal(submitted.data.state, 'submitted');

  const approved = await call('plans/decide', {method: 'POST', body: {
    decision: 'approve', expected_version: submitted.data.version,
    plan_revision_id: submitted.data.plan_revision_id, plan_hash: submitted.data.plan_hash, reason: '同意补货',
  }, headers: {'Idempotency-Key': 'pl1a-12345678'}});
  assert.equal(approved.data.state, 'approved');
  assert.equal(approved.data.plan_hash, plan.data.plan_hash, 'hash frozen through approval');
});

test('approval with wrong hash is rejected (412)', async () => {
  const c = await makeCase('ws-pl2', 'pl2-12345678');
  const plan = await call(`cases/${c.case_id}/plans`, {method: 'POST', body: {title: 'P', payload: {a: 1}}, headers: {'Idempotency-Key': 'pl2p-12345678'}});
  const submitted = await call(`plans/${plan.data.plan_revision_id}/submit`, {method: 'POST', body: {expected_version: plan.data.version}, headers: {'Idempotency-Key': 'pl2s-12345678'}});
  const bad = '0'.repeat(64);
  const res = await call('plans/decide', {method: 'POST', body: {
    decision: 'approve', expected_version: submitted.data.version,
    plan_revision_id: submitted.data.plan_revision_id, plan_hash: bad, reason: 'x',
  }, headers: {'Idempotency-Key': 'pl2a-12345678'}});
  assert.equal(res.status, 412);
});

test('task full lifecycle with evidence on verify', async () => {
  const c = await makeCase('ws-pl3', 'pl3-12345678');
  const plan = await call(`cases/${c.case_id}/plans`, {method: 'POST', body: {title: 'P', payload: {a: 1}}, headers: {'Idempotency-Key': 'pl3p-12345678'}});
  const submitted = await call(`plans/${plan.data.plan_revision_id}/submit`, {method: 'POST', body: {expected_version: plan.data.version}, headers: {'Idempotency-Key': 'pl3s-12345678'}});
  const approved = await call('plans/decide', {method: 'POST', body: {
    decision: 'approve', expected_version: submitted.data.version,
    plan_revision_id: submitted.data.plan_revision_id, plan_hash: submitted.data.plan_hash, reason: 'ok',
  }, headers: {'Idempotency-Key': 'pl3a-12345678'}});

  const task = await call(`plans/${approved.data.plan_revision_id}/tasks`, {method: 'POST', body: {title: '下单补货', action_type: 'replenish'}, headers: {'Idempotency-Key': 'pl3t-12345678'}});
  assert.equal(task.data.state, 'pending_confirmation');

  const base = {plan_revision_id: approved.data.plan_revision_id, reason: 'r', evidence_ids: []};
  const cmd = (command, expected_version, extra = {}) => ({...base, command, expected_version, ...extra});

  const t1 = await call(`tasks/${task.data.task_id}/commands`, {method: 'POST', body: cmd('confirm', 0), headers: {'Idempotency-Key': 'c1-12345678'}});
  assert.equal(t1.data.state, 'ready');
  const t2 = await call(`tasks/${task.data.task_id}/commands`, {method: 'POST', body: cmd('start', 1), headers: {'Idempotency-Key': 'c2-12345678'}});
  assert.equal(t2.data.state, 'in_progress');
  const t3 = await call(`tasks/${task.data.task_id}/commands`, {method: 'POST', body: cmd('submit_completion', 2), headers: {'Idempotency-Key': 'c3-12345678'}});
  assert.equal(t3.data.state, 'pending_verification');
  const t4 = await call(`tasks/${task.data.task_id}/commands`, {method: 'POST', body: cmd('verify', 3, {evidence_ids: ['ev-1']}), headers: {'Idempotency-Key': 'c4-12345678'}});
  assert.equal(t4.data.state, 'completed');
});

test('task CAS conflict returns 409 without side effects', async () => {
  const c = await makeCase('ws-pl4', 'pl4-12345678');
  const plan = await call(`cases/${c.case_id}/plans`, {method: 'POST', body: {title: 'P', payload: {a: 1}}, headers: {'Idempotency-Key': 'pl4p-12345678'}});
  const submitted = await call(`plans/${plan.data.plan_revision_id}/submit`, {method: 'POST', body: {expected_version: plan.data.version}, headers: {'Idempotency-Key': 'pl4s-12345678'}});
  const approved = await call('plans/decide', {method: 'POST', body: {
    decision: 'approve', expected_version: submitted.data.version,
    plan_revision_id: submitted.data.plan_revision_id, plan_hash: submitted.data.plan_hash, reason: 'ok',
  }, headers: {'Idempotency-Key': 'pl4a-12345678'}});
  const task = await call(`plans/${approved.data.plan_revision_id}/tasks`, {method: 'POST', body: {title: 'T', action_type: 'replenish'}, headers: {'Idempotency-Key': 'pl4t-12345678'}});

  const res = await call(`tasks/${task.data.task_id}/commands`, {method: 'POST', body: {
    command: 'confirm', expected_version: 99, plan_revision_id: approved.data.plan_revision_id, reason: 'r', evidence_ids: [],
  }, headers: {'Idempotency-Key': 'pl4x-12345678'}});
  assert.equal(res.status, 409);
  // Task state unchanged (no side effect).
  const fresh = await call(`cases/${c.case_id}/tasks`);
  const t = fresh.data.tasks.find((x) => x.task_id === task.data.task_id);
  assert.equal(t.state, 'pending_confirmation');
  assert.equal(t.version, 0);
});

test('task cannot be created from a non-approved plan', async () => {
  const c = await makeCase('ws-pl5', 'pl5-12345678');
  const plan = await call(`cases/${c.case_id}/plans`, {method: 'POST', body: {title: 'P', payload: {a: 1}}, headers: {'Idempotency-Key': 'pl5p-12345678'}});
  const res = await call(`plans/${plan.data.plan_revision_id}/tasks`, {method: 'POST', body: {title: 'T', action_type: 'replenish'}, headers: {'Idempotency-Key': 'pl5t-12345678'}});
  assert.equal(res.status, 422);
});
