import {recoverLocalReads} from './local-d1-reads.mjs';
import {legacyCompatibleStatements} from './migration-compatibility.mjs';
import { Miniflare } from "miniflare";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
export const DATABASE_ID = "00000000-0000-4000-8000-000000000000";
export async function localRuntime({ persist = false, userId = "local-owner", disableAutomaticPatrol=true, persistRoot } = {}) {
 if(persistRoot){const ownRoot=path.resolve('.');const target=path.resolve(persistRoot);if(!target.startsWith(ownRoot+path.sep))throw Error('Runtime state must stay in calling checkout');persist=true;}
 const stateRoot=persistRoot?path.resolve(persistRoot):path.resolve('.wrangler/state/v3');
 const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('local')}}",compatibilityDate:"2026-05-22",d1Databases:{DB:DATABASE_ID},r2Buckets:{RAW_FILES:"site-creator-r2"},d1Persist:persist?path.join(stateRoot,"d1"):false,r2Persist:persist?path.join(stateRoot,"r2"):false});
 const DB=recoverLocalReads(await mf.getD1Database("DB")),RAW_FILES=await mf.getR2Bucket("RAW_FILES");
 await DB.prepare("CREATE TABLE IF NOT EXISTS neo_local_migrations(name TEXT PRIMARY KEY)").run();
 for(const name of(await readdir("drizzle")).filter(n=>n.endsWith(".sql")).sort()){
  if(await DB.prepare("SELECT name FROM neo_local_migrations WHERE name=?").bind(name).first())continue;
  const statements=(await readFile(`drizzle/${name}`,"utf8")).split("--> statement-breakpoint").map(s=>s.trim()).filter(Boolean);
  await DB.batch([...(await legacyCompatibleStatements(DB,name,statements)).map(s=>DB.prepare(s)),DB.prepare("INSERT INTO neo_local_migrations(name) VALUES(?)").bind(name)]);
 }
 await DB.batch([
  DB.prepare("INSERT OR IGNORE INTO businesses(id,name) VALUES('test-a','本地验收企业 A'),('test-b','本地验收企业 B')"),
  DB.prepare("INSERT OR IGNORE INTO business_members(id,business_id,user_id,role) VALUES('a-owner','test-a','local-owner','admin'),('b-owner','test-b','local-owner','admin'),('a-reader','test-a','local-reader','reader'),('a-importer','test-a','local-importer','importer'),('b-only','test-b','local-b-only','admin')")
 ]);
 return{mf,runtime:{DB,RAW_FILES,disableAutomaticPatrol,local:{enabled:true,development:true,userId}}};
}
