import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
test('generation session migration preserves old sessions, runs and enforced references',async()=>{
 const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('test')}}",compatibilityDate:'2026-05-22',d1Databases:{DB:'00000000-0000-4000-8000-000000000000'}});
 try{const db=await mf.getD1Database('DB');
  for(const name of (await readdir('drizzle')).filter(x=>x.endsWith('.sql')&&x<'0014').sort())await db.batch((await readFile('drizzle/'+name,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
  await db.batch([db.prepare("INSERT INTO businesses VALUES('a','旧企业')"),db.prepare("INSERT INTO operating_snapshots VALUES('old-snapshot','a','demo','2026-09-30','{}')"),db.prepare("INSERT INTO neo_sessions VALUES('old-session','a','demo','old-snapshot','owner','2026-09-30')"),db.prepare("INSERT INTO neo_runs(id,business_id,data_nature,snapshot_id,session_id,request_id,request_hash,payload,status,created_at,updated_at) VALUES('old-run','a','demo','old-snapshot','old-session','old-request','hash','{}','completed','2026-09-30','2026-09-30')")]);
  await db.batch((await readFile('drizzle/0014_bizarre_mordo.sql','utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
  assert.equal((await db.prepare("SELECT generation_id FROM neo_sessions WHERE id='old-session'").first()).generation_id,null);
  assert.equal((await db.prepare("SELECT session_id FROM neo_runs WHERE id='old-run'").first()).session_id,'old-session');
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  await assert.rejects(db.prepare("INSERT INTO neo_sessions VALUES('bad','a','demo',NULL,'owner','now','foreign-generation')").run(),/FOREIGN KEY/);
 }finally{await mf.dispose();}
});
