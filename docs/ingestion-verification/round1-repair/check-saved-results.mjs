// Only verifies the named disposable round-1 repair fixture on localhost:3102.
// Does not import new facts; the one POST repeats an already committed batch.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin = 'http://127.0.0.1:3102';
const batchId = '8eeb1586-fd4b-4e70-9e85-8782bd027a9d';
const oldId = 'snap-aa67f4067707d090685b3f0101a48d74e86791dda86d6a281bbfc35297ed74c8';
const newId = 'snap-99bd0287d700b3956487fe96b95a96a1a0ceaef0b581a82cd59323303cb47aea';
const checks = [];
async function request(path, status = 200, options = {}) {
    const response = await fetch(origin + '/api/v1/' + path, {cache: 'no-store', ...options});
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify({path, data}));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    checks.push({method: options.method || 'GET', path, status: response.status, data});
    return data;
}
const initial = await request('ingestion-batches?businessId=test-a&dataNature=demo');
assert.equal(initial.items.length, 5);
assert.equal(initial.items.reduce((n, b) => n + b.imported_count, 0), 10);
const repeated = await request(`ingestion-batches/${batchId}/commit?businessId=test-a`, 200, {
    method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'},
    body: JSON.stringify({validationVersion: 1}),
});
assert.equal(repeated.batch.status, 'committed');
assert.equal(repeated.batch.imported_count, 1);
const final = await request('ingestion-batches?businessId=test-a&dataNature=demo');
assert.deepEqual(final.items, initial.items);
const old = (await request(`operating-snapshot?businessId=test-a&dataNature=demo&snapshotId=${oldId}`)).snapshot;
const latest = (await request(`operating-snapshot?businessId=test-a&dataNature=demo&snapshotId=${newId}`)).snapshot;
assert.equal(old.data.events.A1, 100);
assert.equal(latest.data.events.A1, 107);
assert.equal(latest.data.weeks[0].events.A1, 107);
assert.deepEqual(latest.data.financial, old.data.financial);
const evidence = await request(`evidence/${encodeURIComponent(latest.evidenceIds.A1)}?businessId=test-a`);
assert.equal(evidence.evidence.snapshotId, newId);
assert.equal(evidence.evidence.businessId, 'test-a');
assert.equal(evidence.evidence.value, 107);
assert.equal(evidence.records.length, 2);
assert.deepEqual(evidence.records.map(r => JSON.parse(r.payload).quantity).sort((a,b) => a-b), [7,100]);
assert.ok(evidence.records.every(r => r.row_number === 2));
const previousEvidence = await request(`evidence/${encodeURIComponent(old.evidenceIds.A1)}?businessId=test-a`);
assert.equal(previousEvidence.evidence.value, 100);
assert.equal(previousEvidence.records.length, 1);
const b = await request('ingestion-batches?businessId=test-b&dataNature=demo');
assert.equal(b.items.length, 0);
assert.equal((await request('operating-snapshot?businessId=test-b&dataNature=demo')).snapshot, null);
assert.equal((await request('operating-snapshot?businessId=test-a&dataNature=business')).snapshot, null);
await request(`operating-snapshot?businessId=test-b&dataNature=demo&snapshotId=${newId}`, 404);
await request(`evidence/${encodeURIComponent(latest.evidenceIds.A1)}?businessId=test-b`, 404);
await request('evidence/missing?businessId=test-a', 404);
await request(`ingestion-batches/${batchId}?businessId=test-b`, 404);
const unauthorizedFile = await fetch(`${origin}/api/v1/ingestion-batches/${batchId}/file?businessId=test-b`);
assert.equal(unauthorizedFile.status, 404);
checks.push({method:'GET', path:`ingestion-batches/${batchId}/file?businessId=test-b`, status:404, data:await unauthorizedFile.json()});
const original = await readFile('/private/tmp/neo-r1-repair-MnU654/repair-add-seven.csv');
const downloaded = await readFile('/Users/majun/Downloads/original.csv');
const rawResponse = await fetch(`${origin}/api/v1/ingestion-batches/${batchId}/file?businessId=test-a`);
assert.equal(rawResponse.status, 200);
const saved = Buffer.from(await rawResponse.arrayBuffer());
assert.deepEqual(saved, original);
assert.deepEqual(downloaded, original);
const hash = createHash('sha256').update(original).digest('hex');
const result = {time: new Date().toISOString(), origin, batchId, oldId, newId, passed:true, checks,
    counts:{batches:5, facts:10}, originalFile:{bytes:original.length, sha256:hash, browserDownloadMatches:true, r2DownloadMatches:true}};
await writeFile(new URL('./saved-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({passed:true, checks:checks.length, batches:5, facts:10, oldA1:100, newA1:107, originalSha256:hash}, null, 2));
