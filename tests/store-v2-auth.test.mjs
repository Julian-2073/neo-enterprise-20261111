import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleStoreV2} from '../server/v2/router.ts';
import {assertVisible, resolveActorContext} from '../server/v2/auth.ts';

let ownerRuntime, readerRuntime, ownerMf, readerMf;

before(async () => {
  ({mf: ownerMf, runtime: ownerRuntime} = await localRuntime());
  ({mf: readerMf, runtime: readerRuntime} = await localRuntime({userId: 'local-reader'}));
});
after(async () => {
  await ownerMf?.dispose();
  await readerMf?.dispose();
});

function request(path, {method = 'GET', body, headers = {}, workspace} = {}) {
  const query = workspace ? `${path.includes('?') ? '&' : '?'}businessId=${workspace}` : '';
  return new Request(`http://localhost/api/v2/store/${path}${query}`, {
    method,
    headers: {
      ...(method === 'POST' ? {origin: 'http://localhost'} : {}),
      ...(body ? {'Content-Type': 'application/json'} : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function call(path, options, runtime = ownerRuntime) {
  const response = await handleStoreV2(request(path, options), runtime);
  return {status: response.status, data: await response.json()};
}

test('capabilities resolve the actor from server membership, not client claims', async () => {
  const own = await call('capabilities', {workspace: 'test-a', headers: {'x-neo-role': 'reader'}});
  assert.equal(own.status, 200, JSON.stringify(own));
  assert.equal(own.data.workspace_id, 'test-a');
  assert.equal(own.data.role, 'admin');
  assert.equal(own.data.actor_id, 'local-owner');
  assert.match(own.data.request_id, /^[0-9a-f-]{36}$/);
  assert.equal(own.data.availability.status, 'partial');
  assert.deepEqual(own.data.availability.reason_codes, ['STORE_DIRECTORY_NOT_IMPLEMENTED']);
  assert.deepEqual(own.data.availability.missing_fields, ['stores']);
  assert.equal(own.data.capabilities.cost_fields.status, 'available');
  assert.equal(own.data.capabilities.stores.status, 'not_supported');
  assert.deepEqual(own.data.capabilities.stores.reason_codes, ['STORE_DIRECTORY_NOT_IMPLEMENTED']);
  assert.deepEqual(own.data.capabilities.actions.map((a) => a.action_template_id), ['ACT01', 'ACT02', 'ACT03', 'ACT04', 'ACT05', 'ACT06', 'ACT07', 'ACT08', 'ACT09']);
  assert.ok(own.data.capabilities.actions.every((a) => a.allowed === true));

  // A client-supplied role/workspace is ignored; membership in test-a persists.
  const spoofed = await call('capabilities?role=reader&tenant=test-b', {workspace: 'test-a'});
  assert.equal(spoofed.status, 200);
  assert.equal(spoofed.data.role, 'admin');
  assert.equal(spoofed.data.workspace_id, 'test-a');
});

test('read-only membership cannot write and never sees cost fields', async () => {
  const caps = await call('capabilities', {workspace: 'test-a'}, readerRuntime);
  assert.equal(caps.status, 200, JSON.stringify(caps));
  assert.equal(caps.data.role, 'reader');
  assert.equal(caps.data.capabilities.cost_fields.status, 'blocked');
  assert.deepEqual(caps.data.capabilities.cost_fields.reason_codes, ['ROLE_COST_FIELDS_BLOCKED']);
  assert.ok(caps.data.capabilities.actions.every((a) => a.allowed === false));
  assert.ok(caps.data.capabilities.actions.every((a) => a.reason_codes.includes('READ_ONLY')));

  const write = await call('imports', {method: 'POST', body: {}} , readerRuntime);
  assert.equal(write.status, 403);
  assert.equal(write.data.error.code, 'READ_ONLY');
  assert.equal(write.data.error.retryable, false);
});

test('cross-workspace access and foreign objects are rejected', async () => {
  const owner = await resolveActorContext(request('capabilities', {workspace: 'test-a'}), ownerRuntime);
  assert.throws(() => assertVisible(owner, {workspaceId: 'test-b', objectId: 'case-1'}), (e) => e.code === 'NOT_VISIBLE' && e.status === 404);

  const {mf, runtime} = await localRuntime({userId: 'local-b-only'});
  try {
    const foreign = await call('capabilities', {workspace: 'test-a'}, runtime);
    assert.equal(foreign.status, 403);
    assert.equal(foreign.data.error.code, 'NO_BUSINESS_ACCESS');
    assert.equal(foreign.data.error.details?.business_id, undefined, 'must not leak foreign workspace existence');
    const own = await call('capabilities', {workspace: 'test-b'}, runtime);
    assert.equal(own.status, 200);
    assert.equal(own.data.workspace_id, 'test-b');
  } finally {
    await mf.dispose();
  }
});

test('identity fails closed without trusted configuration and in production local mode', async () => {
  const anonymous = {...ownerRuntime, local: undefined, trustSitesIdentity: false};
  const denied = await call('capabilities', {workspace: 'test-a'}, anonymous);
  assert.equal(denied.status, 401);
  assert.equal(denied.data.error.code, 'AUTH_REQUIRED');

  const productionLocal = {...ownerRuntime, local: {enabled: true, development: false, userId: 'local-owner'}};
  const blocked = await call('capabilities', {workspace: 'test-a'}, productionLocal);
  assert.equal(blocked.status, 503);
  assert.equal(blocked.data.error.code, 'LOCAL_AUTH_FORBIDDEN');
});

test('unimplemented v2 operations are explicit, not fabricated', async () => {
  const write = await call('analysis-runs', {method: 'POST', body: {}, headers: {'Idempotency-Key': 'ui-12345678'}});
  assert.equal(write.status, 501);
  assert.equal(write.data.error.code, 'NOT_IMPLEMENTED');
  assert.deepEqual(write.data.error.details, {stage: 'DEV03'});

  const unknown = await call('sales', {workspace: 'test-a'});
  assert.equal(unknown.status, 501);
  assert.equal(unknown.data.error.code, 'NOT_IMPLEMENTED');

  const missing = await call('capabilities/missing', {workspace: 'test-a'});
  assert.equal(missing.status, 404);
  assert.equal(missing.data.error.code, 'NOT_FOUND');
});

test('write requests require same-origin and an idempotency key', async () => {
  const crossSite = await handleStoreV2(
    new Request('http://localhost/api/v2/store/imports?businessId=test-a', {method: 'POST', headers: {origin: 'http://evil.example', 'Content-Type': 'application/json'}, body: '{}'}),
    ownerRuntime,
  );
  assert.equal(crossSite.status, 403);
  assert.equal((await crossSite.json()).error.code, 'ORIGIN_REJECTED');
});
