import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const root=process.argv[2];if(!root)throw Error('Usage: node scripts/seed-agent-demo.mjs /path/to/虚拟数据库_Demo [http://127.0.0.1:3000] [businessId]');
const base=process.argv[3]||'http://127.0.0.1:3000';if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('合成数据种子仅允许本地服务');
const business=process.argv[4]||'test-a';if(!/^[a-zA-Z0-9_-]+$/.test(business))throw Error('企业 ID 格式无效');
async function request(path,body){const r=await fetch(base+'/api/v1/'+path+'?businessId='+business,{method:'POST',headers:{Origin:base,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v;}
for(const kind of ['events','orders','inventory','expenses']){const data=await readFile(join(root,'imports',kind+'.csv'));const form=new FormData();form.set('file',new File([data],kind+'.csv'));for(const [k,v] of Object.entries({kind,sourceName:'NEO Demo 虚拟数据库 v1',dataNature:'demo',templateVersion:'1',coverageStart:'2026-07-27',coverageEnd:kind==='inventory'?'2026-09-24':'2026-09-20'}))form.set(k,v);const {batch}=await request('ingestion-batches',form);if(batch.status!=='committed'){if(batch.status!=='ready')throw Error(kind+' validation '+batch.status);await request(`ingestion-batches/${batch.id}/commit`,{validationVersion:batch.validation_version});}}
const output=join(tmpdir(),'neo-domain-'+process.pid+'.json');const p=spawnSync('python3',['scripts/prepare-agent-demo.py',resolve(root),output],{stdio:'inherit'});if(p.status)process.exit(p.status);
await request('agent-domain',JSON.parse(await readFile(output,'utf8')));
const {snapshot}=await request('operating-snapshots',{dataNature:'demo',asOf:'2026-09-24',periodStart:'2026-07-27',periodEnd:'2026-09-20'});
console.log(JSON.stringify({snapshotId:snapshot.id,url:base+'/demo?businessId='+business+'&dataNature=demo&snapshotId='+snapshot.id,dataNature:'SYNTHETIC_DEMO'}));
