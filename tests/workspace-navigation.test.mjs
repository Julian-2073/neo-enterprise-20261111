import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { useWorkspace } from '../components/business/use-workspace.ts';

const origin = 'http://localhost:3102';
const oldURL = `${origin}/analysis/people?businessId=test-a&dataNature=demo&snapshotId=old-100`;
const fixtures = Object.fromEntries(['old-100', 'new-107'].map(id => [id, {
  id, businessId: 'test-a', dataNature: 'demo', asOf: '2026-09-02',
  periodStart: '2026-09-01', periodEnd: '2026-09-02', productId: null, channel: null,
  data: { events: { A1: id === 'old-100' ? 100 : 107 } },
}]));
let dom, root, view, latest, fetchHandler;
const descriptors = new Map();
function bind(name, value) {
  if (!descriptors.has(name)) descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
function Probe() {
  const workspace = useWorkspace();
  useEffect(() => { latest = workspace; });
  return React.createElement('output', null, JSON.stringify({
    business: workspace.business, nature: workspace.nature,
    snapshotId: workspace.snapshot?.id ?? null, exposure: workspace.snapshot?.data.events.A1 ?? null,
    error: workspace.error, busy: workspace.busy,
  }));
}
function read() { return JSON.parse(view.textContent); }
async function settle(predicate) {
  for (let i = 0; i < 40; i++) {
    await act(async () => { await tick(); });
    if (predicate(read())) return;
  }
  assert.fail(`页面状态未达到预期: ${view.textContent}`);
}
async function mount(url = oldURL) {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url });
  bind('window', dom.window); bind('document', dom.window.document);
  bind('navigator', dom.window.navigator); bind('IS_REACT_ACT_ENVIRONMENT', true);
  bind('fetch', async (path, options) => fetchHandler(new URL(path, origin), options));
  view = document.getElementById('root'); root = createRoot(view);
  await act(async () => { root.render(React.createElement(Probe)); });
  await settle(s => s.business !== '');
}
async function unmount() {
  await act(async () => root?.unmount()); root = null; dom?.window.close();
}
async function reopen(url) { await unmount(); await mount(url); }
async function historyMove(direction) {
  await act(async () => {
    const event = new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }));
    window.history[direction](); await event;
  });
}
beforeEach(() => {
  fetchHandler = async (url, options = {}) => {
    if (url.pathname.endsWith('businesses/current')) return Response.json({
      current: { id: 'test-a', name: 'A', role: 'admin' },
      businesses: [{ id: 'test-a', name: 'A', role: 'admin' }, { id: 'test-b', name: 'B', role: 'admin' }],
    });
    if (options.method === 'POST') return Response.json({ snapshot: fixtures['new-107'] });
    const q = url.searchParams;
    return Response.json({ snapshot: q.get('businessId') === 'test-a' && q.get('dataNature') === 'demo'
      ? fixtures[q.get('snapshotId') || 'new-107'] : null });
  };
});
afterEach(async () => {
  await unmount();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  descriptors.clear();
});

test('A→B updates the current URL, clears the old snapshot and survives reload / copied link', async () => {
  await mount(); await settle(s => s.exposure === 100);
  await act(async () => latest.setBusiness('test-b'));
  await settle(s => s.business === 'test-b' && s.snapshotId === null);
  const url = new URL(window.location.href);
  assert.equal(url.searchParams.get('businessId'), 'test-b');
  assert.equal(url.searchParams.has('snapshotId'), false);
  await reopen(url.href); await settle(s => s.business === 'test-b');
  assert.equal(read().exposure, null);
});

test('demo→business remains selected after reopening the exact address', async () => {
  await mount(); await settle(s => s.exposure === 100);
  await act(async () => latest.setNature('business'));
  await settle(s => s.nature === 'business' && s.snapshotId === null);
  assert.equal(new URL(window.location.href).searchParams.get('dataNature'), 'business');
  const url = window.location.href; await reopen(url);
  await settle(s => s.business === 'test-a' && s.nature === 'business');
  assert.equal(read().exposure, null);
});

test('publish pins 107 in the URL; reload and back/forward restore new and historical snapshots', async () => {
  await mount(); await settle(s => s.exposure === 100);
  await act(async () => { await latest.publish(); });
  assert.equal(read().exposure, 107);
  assert.equal(new URL(window.location.href).searchParams.get('snapshotId'), 'new-107');
  await historyMove('back'); await settle(s => s.exposure === 100);
  await historyMove('forward'); await settle(s => s.exposure === 107);
  const url = window.location.href; await reopen(url); await settle(s => s.exposure === 107);
  await reopen(oldURL); await settle(s => s.exposure === 100);
});

test('a slow request from A cannot overwrite B or its URL', async () => {
  let completeA;
  const original = fetchHandler;
  fetchHandler = async (url, options) => url.pathname.endsWith('operating-snapshot') && url.searchParams.get('businessId') === 'test-a'
    ? new Promise(resolve => { completeA = resolve; }) : original(url, options);
  await mount(); await settle(s => s.business === 'test-a');
  await act(async () => latest.setBusiness('test-b'));
  await settle(s => s.business === 'test-b');
  await act(async () => completeA(Response.json({ snapshot: fixtures['old-100'] })));
  assert.equal(read().business, 'test-b'); assert.equal(read().exposure, null);
  assert.equal(new URL(window.location.href).searchParams.get('businessId'), 'test-b');
});

test('back/forward restores enterprise and data nature as well as the snapshot', async () => {
  await mount(); await settle(s => s.exposure === 100);
  await act(async () => latest.setBusiness('test-b'));
  await settle(s => s.business === 'test-b');
  await act(async () => latest.setNature('business'));
  await settle(s => s.nature === 'business');
  await historyMove('back'); await settle(s => s.business === 'test-b' && s.nature === 'demo');
  await historyMove('back'); await settle(s => s.business === 'test-a' && s.exposure === 100);
  await historyMove('forward'); await settle(s => s.business === 'test-b' && s.exposure === null);
});

test('a slow publish cannot restore A after browser history moves to B', async () => {
  await mount(); await settle(s => s.exposure === 100);
  await act(async () => latest.setBusiness('test-b'));
  await settle(s => s.business === 'test-b');
  await historyMove('back'); await settle(s => s.exposure === 100);
  let completePublish, pending;
  const original = fetchHandler;
  fetchHandler = async (url, options) => options?.method === 'POST'
    ? new Promise(resolve => { completePublish = resolve; }) : original(url, options);
  await act(async () => { pending = latest.publish().then(() => 'unexpected success', e => e.message); });
  await historyMove('forward'); await settle(s => s.business === 'test-b');
  await act(async () => completePublish(Response.json({ snapshot: fixtures['new-107'] })));
  assert.match(await pending, /范围已改变/);
  assert.equal(read().business, 'test-b'); assert.equal(read().error, ''); assert.equal(read().busy, false);
  assert.equal(new URL(window.location.href).searchParams.get('businessId'), 'test-b');
});

test('an unknown historical snapshot shows its error and never falls back to the latest', async () => {
  const original = fetchHandler, requested = [];
  fetchHandler = async (url, options) => {
    if (url.pathname.endsWith('operating-snapshot')) {
      requested.push(url.searchParams.get('snapshotId'));
      return Response.json({ error: { message: '快照不存在' } }, { status: 404 });
    }
    return original(url, options);
  };
  await mount(oldURL.replace('old-100', 'missing'));
  await settle(s => s.error === '快照不存在');
  assert.equal(read().exposure, null);
  assert.equal(new URL(window.location.href).searchParams.get('snapshotId'), 'missing');
  assert.deepEqual(requested, ['missing']);
});

test('scoped frontend links retain page query and hash without a second question mark', async () => {
  await mount(); await settle(s => s.exposure === 100);
  const url = new URL(latest.href('/demo?page=goods#stock'), origin);
  assert.equal(url.searchParams.get('page'), 'goods');
  assert.equal(url.searchParams.get('businessId'), 'test-a');
  assert.equal(url.searchParams.get('snapshotId'), 'old-100');
  assert.equal(url.hash, '#stock');
});

test('explicit historical selection clears a different baseline and restores the selected snapshot after reload',async()=>{
 await mount(oldURL+'&baselineId=old-forecast&scenarioId=old-scenario&proposalRunId=old-run&reviewRunId=old-review');await settle(s=>s.exposure===100);
 await act(async()=>latest.selectSnapshot('new-107'));await settle(s=>s.exposure===107);
 const selected=window.location.href;for(const key of ['baselineId','scenarioId','proposalRunId','reviewRunId'])assert.equal(new URL(selected).searchParams.has(key),false);
 await reopen(selected);await settle(s=>s.exposure===107);assert.equal(read().snapshotId,'new-107');
});

test('full-history refresh delegates dates to backend; deliberate date edits still select an explicit window',async()=>{
 const fixture={...fixtures['old-100'],periodMode:'all_imported'};
 let submitted;const original=fetchHandler;
 fetchHandler=async(url,options={})=>{
  if(options.method==='POST'){submitted=JSON.parse(options.body);return Response.json({snapshot:{...fixtures['new-107'],periodMode:'all_imported'}});}
  if(url.pathname.endsWith('operating-snapshot'))return Response.json({snapshot:fixture});
  return original(url,options);
 };
 await mount();await settle(s=>s.exposure===100);
 await act(async()=>{await latest.publish();});
 assert.equal(submitted.periodMode,'all_imported');
 for(const k of ['asOf','periodStart','periodEnd'])assert.equal(k in submitted,false);
 await act(async()=>{await latest.publish({periodStart:'2026-08-01'});});
 assert.equal(submitted.periodStart,'2026-08-01');assert.equal('periodMode' in submitted,false);
});
