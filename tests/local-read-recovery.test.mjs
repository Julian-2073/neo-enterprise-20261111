import assert from 'node:assert/strict';
import test from 'node:test';
import {recoverLocalReads} from '../scripts/local-d1-reads.mjs';

test('a lost bound SELECT receipt can be read again',async()=>{
 let reads=0;const values=[];const database={prepare(sql){return {bind(...bound){values.push(bound);return this;},async first(){reads++;if(reads===1)throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});return {business:'b',id:boundValue(sql)};}};}};
 const db=recoverLocalReads(database,{onRetry(){}});assert.deepEqual(await db.prepare('SELECT id FROM snapshots WHERE business=?').bind('b').first(),{business:'b',id:'snapshot'});assert.deepEqual(values,[['b']]);assert.equal(reads,2);
});
function boundValue(sql){assert.match(sql,/snapshots/);return 'snapshot';}

test('lost mutation or batch receipts are never replayed',async()=>{
 let writes=0,batches=0;const database={prepare(){return {async all(){writes++;throw new TypeError('fetch failed');},async run(){writes++;throw new TypeError('fetch failed');}};},async batch(){batches++;throw new TypeError('fetch failed');}};
 const db=recoverLocalReads(database,{onRetry(){assert.fail('must not replay a write');}});
 await assert.rejects(db.prepare('UPDATE jobs SET status=? RETURNING *').all(),/fetch failed/);await assert.rejects(db.prepare('INSERT INTO jobs VALUES (?)').run(),/fetch failed/);await assert.rejects(db.batch([]),/fetch failed/);assert.equal(writes,2);assert.equal(batches,1);
});

test('persistent transport failure and SQL errors remain failures',async()=>{
 for(const message of ['fetch failed','no such table: missing']){
  let count=0;const db=recoverLocalReads({prepare(){return {async first(){count++;throw new Error(message);}};}},{onRetry(){}});
  await assert.rejects(db.prepare('SELECT id FROM missing').first(),new RegExp(message));assert.equal(count,message==='fetch failed'?2:1);
 }
});
