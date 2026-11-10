import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseScope, scopeHash} from '../lib/store-v2/contracts/scope.ts';
import {assertCents, sumKnown, totalCents} from '../lib/store-v2/contracts/money.ts';
import {availabilityForGrain, assertGrainSupports} from '../lib/store-v2/contracts/grain.ts';
import {buildMetricResult} from '../lib/store-v2/contracts/metric-result.ts';
import {availability} from '../lib/store-v2/contracts/availability.ts';
import {parseSkuKey} from '../lib/store-v2/contracts/style-color.ts';
import {
  CASE_TRANSITIONS,
  PLAN_TRANSITIONS,
  TASK_TRANSITIONS,
  assertApprovalDecision,
  nextTaskState,
  requireIdempotencyKey,
  validateTaskCommand,
} from '../lib/store-v2/contracts/commands.ts';

const base = {
  workspace_id: 'test-a',
  store_ids: ['store-01', 'store-02'],
  window: {start: '2026-09-01T00:00:00Z', end: '2026-09-30T23:59:59Z'},
  baseline: null,
  business_timezone: 'Asia/Shanghai',
  snapshot_id: 'snap-20260930',
  metric_contract_version: 'metric-v2.0',
  view_policy_version: 'view-v2.0',
  order_scope_mode: 'matched_lines',
  filters: {channel: '抖音', data_kind: 'synthetic', flag: true},
};

test('Scope validates the v2 contract and hashes deterministically', async () => {
  const scope = parseScope(base);
  assert.equal(scope.workspace_id, 'test-a');
  assert.deepEqual(scope.store_ids, ['store-01', 'store-02']);
  const hash = await scopeHash(scope);
  assert.match(hash, /^[0-9a-f]{64}$/);
  // Filter key order must not change the scope identity.
  assert.equal(hash, await scopeHash(parseScope({...base, filters: {flag: true, data_kind: 'synthetic', channel: '抖音'}})));
  // Store order is part of identity when it changes the selected stores.
  assert.notEqual(hash, await scopeHash(parseScope({...base, store_ids: ['store-02', 'store-01']})));
  assert.notEqual(hash, await scopeHash(parseScope({...base, window: {start: '2026-09-02T00:00:00Z', end: '2026-09-30T23:59:59Z'}})));
  assert.match(await scopeHash(parseScope({...base, baseline: {start: '2026-08-01T00:00:00Z', end: '2026-08-31T23:59:59Z'}})), /^[0-9a-f]{64}$/);
  // Filters are copied, not aliased to caller objects.
  scope.filters.channel = '天猫';
  assert.equal(parseScope(base).filters.channel, '抖音');
});

test('Scope rejects structurally illegal requests with a stable code', () => {
  const invalid = [
    {...base, workspace_id: ''},
    {...base, store_ids: []},
    {...base, window: {start: '2026-09-30T00:00:00Z', end: '2026-09-01T00:00:00Z'}},
    {...base, window: {start: '2026-09-01', end: '2026-09-30T23:59:59Z'}},
    {...base, order_scope_mode: 'all'},
    {...base, baseline: {start: '2026-08-01T00:00:00Z'}},
    {...base, business_timezone: ''},
    {...base, snapshot_id: ''},
    {...base, filters: []},
    null,
  ];
  for (const value of invalid) assert.throws(() => parseScope(value), (e) => e.code === 'INVALID_SCOPE' && e.status === 422, JSON.stringify(value));
});

test('Money stays in safe integers and never turns unknown into zero', () => {
  assert.equal(assertCents(0), 0);
  assert.equal(assertCents(-150), -150);
  assert.throws(() => assertCents(1.5), (e) => e.code === 'INVALID_MONEY' && e.status === 422);
  assert.throws(() => assertCents('100'), (e) => e.code === 'INVALID_MONEY');
  assert.throws(() => assertCents(Number.MAX_SAFE_INTEGER + 1), (e) => e.code === 'MONEY_OUT_OF_RANGE');
  assert.throws(() => assertCents(Number.POSITIVE_INFINITY), (e) => e.code === 'MONEY_OUT_OF_RANGE');
  assert.equal(totalCents([0, 0]), 0);
  assert.equal(totalCents([null, 100]), null);
  assert.equal(totalCents([undefined, 100]), null);
  assert.equal(sumKnown([null, 100]), 100);
  assert.equal(sumKnown([null]), null);
  assert.throws(() => sumKnown([Number.MAX_SAFE_INTEGER, 1]), (e) => e.code === 'MONEY_OUT_OF_RANGE');
});

test('day_sku grain never fabricates order-level metrics', () => {
  for (const metric of ['order_count', 'atv', 'basket', 'campaign_order_union']) {
    const value = availabilityForGrain('day_sku', metric);
    assert.equal(value.status, 'not_supported');
    assert.deepEqual(value.reason_codes, ['GRAIN_NOT_SUPPORTED']);
    assert.deepEqual(value.missing_fields, [metric]);
    assert.equal(value.coverage, null);
    assert.throws(() => assertGrainSupports('day_sku', metric), (e) => e.code === 'GRANULARITY_NOT_SUPPORTED' && e.status === 422);
  }
  assert.equal(availabilityForGrain('day_sku', 'sales').status, 'available');
  assert.equal(availabilityForGrain('order_line', 'order_count').status, 'available');
  assert.equal(availabilityForGrain('order_line', 'campaign_order_union').status, 'available');
  assertGrainSupports('order_line', 'atv');
});

test('MetricResult keeps null for blocked/not_supported and allows proven zero', async () => {
  const hash = await scopeHash(parseScope(base));
  const scope = {
    metric_id: 'net_revenue_cents',
    metric_contract_version: 'metric-v2.0',
    scope_hash: hash,
    snapshot_id: 'snap-20260930',
    unit: 'CNY_cents',
    denominator: null,
    evidence_ids: [],
    calculated_at: '2026-10-01T00:00:00.000Z',
  };
  const blocked = buildMetricResult({...scope, value: null, availability: availability('blocked', ['COVERAGE_INCOMPLETE'], 0.4, ['orders'])});
  assert.equal(blocked.value, null);
  assert.equal(blocked.availability.status, 'blocked');
  const unsupported = buildMetricResult({...scope, value: null, availability: availabilityForGrain('day_sku', 'order_count')});
  assert.equal(unsupported.value, null);
  const zero = buildMetricResult({...scope, value: 0, availability: availability('available', [], 1, [])});
  assert.equal(zero.value, 0);
  assert.throws(
    () => buildMetricResult({...scope, value: 0, availability: availabilityForGrain('day_sku', 'order_count')}),
    (e) => e.code === 'INVALID_METRIC_RESULT' && e.status === 422,
  );
  assert.throws(
    () => buildMetricResult({...scope, value: Number.MAX_SAFE_INTEGER + 1, availability: availability('available', [], 1, [])}),
    (e) => e.code === 'MONEY_OUT_OF_RANGE',
  );
  assert.throws(
    () => buildMetricResult({...scope, value: null, denominator: -1, availability: availability('available', [], 1, [])}),
    (e) => e.code === 'INVALID_METRIC_RESULT',
  );
  assert.throws(
    () => buildMetricResult({...scope, value: 1, scope_hash: 'not-a-hash', availability: availability('available', [], 1, [])}),
    (e) => e.code === 'INVALID_METRIC_RESULT',
  );
});

test('Style-color-size keys are parsed and rejected without guessing', () => {
  assert.deepEqual(parseSkuKey('ST-001/红色/EU/42'), {style_code: 'ST-001', color_code: '红色', size_system: 'EU', size_code: '42'});
  assert.deepEqual(parseSkuKey(' ST-002 / 黑 / CN / 260 '), {style_code: 'ST-002', color_code: '黑', size_system: 'CN', size_code: '260'});
  for (const value of ['ST-001/EU/42', 'ST-001/红色/EU/', '/红色/EU/42', 'ST-001/红色/EU/42/extra', '', 'ST 001/红色/EU/42']) {
    assert.throws(() => parseSkuKey(value), (e) => e.code === 'INVALID_STYLE_COLOR_KEY' && e.status === 422, value);
  }
});

test('Command contracts enforce state machines, versions and approval bindings', () => {
  assert.deepEqual(Object.keys(TASK_TRANSITIONS), ['pending_confirmation', 'ready', 'in_progress', 'pending_verification', 'blocked', 'completed', 'cancelled']);
  assert.deepEqual(TASK_TRANSITIONS.completed, []);
  assert.deepEqual(CASE_TRANSITIONS.closed, ['investigating']);
  assert.deepEqual(PLAN_TRANSITIONS.approved, ['superseded']);
  assert.equal(nextTaskState('pending_confirmation', 'confirm'), 'ready');
  assert.equal(nextTaskState('ready', 'start'), 'in_progress');
  assert.equal(nextTaskState('in_progress', 'submit_completion'), 'pending_verification');
  assert.equal(nextTaskState('pending_verification', 'verify'), 'completed');
  assert.equal(nextTaskState('pending_verification', 'return_for_revision'), 'in_progress');
  assert.equal(nextTaskState('blocked', 'resume', 'in_progress'), 'in_progress');
  assert.throws(() => nextTaskState('pending_confirmation', 'verify'), (e) => e.code === 'ILLEGAL_TRANSITION' && e.status === 409);
  assert.throws(() => nextTaskState('blocked', 'resume'), (e) => e.code === 'ILLEGAL_TRANSITION' && e.status === 409);

  const command = {command: 'start', expected_version: 2, plan_revision_id: 'rev-1', reason: '开始执行', evidence_ids: []};
  assert.equal(validateTaskCommand(command, {from: 'ready'}).next_state, 'in_progress');
  assert.throws(() => validateTaskCommand(command, {from: 'pending_confirmation'}), (e) => e.code === 'ILLEGAL_TRANSITION');
  assert.throws(() => validateTaskCommand({...command, expected_version: undefined}), (e) => e.code === 'VERSION_REQUIRED' && e.status === 422);
  assert.throws(() => validateTaskCommand({...command, command: 'approve'}), (e) => e.code === 'INVALID_COMMAND');
  assert.throws(() => validateTaskCommand({...command, reason: '  '}), (e) => e.code === 'INVALID_COMMAND');

  const decision = {decision: 'approve', expected_version: 3, plan_revision_id: 'rev-1', plan_hash: 'a'.repeat(64), reason: '同意'};
  assert.equal(assertApprovalDecision(decision, {version: 3, plan_revision_id: 'rev-1', plan_hash: 'a'.repeat(64)}).decision, 'approve');
  assert.throws(
    () => assertApprovalDecision(decision, {version: 4, plan_revision_id: 'rev-1', plan_hash: 'a'.repeat(64)}),
    (e) => e.code === 'VERSION_CONFLICT' && e.status === 409,
  );
  assert.throws(
    () => assertApprovalDecision({...decision, plan_hash: 'b'.repeat(64)}, {version: 3, plan_revision_id: 'rev-1', plan_hash: 'a'.repeat(64)}),
    (e) => e.code === 'PRECONDITION_FAILED' && e.status === 412,
  );
  assert.throws(
    () => assertApprovalDecision({...decision, plan_revision_id: 'rev-2'}, {version: 3, plan_revision_id: 'rev-1', plan_hash: 'a'.repeat(64)}),
    (e) => e.code === 'PRECONDITION_FAILED',
  );
});

test('Write commands require an idempotency key', () => {
  assert.equal(requireIdempotencyKey(new Headers({'idempotency-key': 'cmd-20261001-0001'})), 'cmd-20261001-0001');
  for (const value of [undefined, 'short', 'x'.repeat(201)]) {
    const headers = new Headers();
    if (value !== undefined) headers.set('idempotency-key', value);
    assert.throws(() => requireIdempotencyKey(headers), (e) => e.code === 'INVALID_COMMAND' && e.status === 422);
  }
});
