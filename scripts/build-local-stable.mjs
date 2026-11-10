import {mkdir,cp,symlink,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {homedir} from 'node:os';
import {createBuilder} from 'vite';
import {stableSource} from './stable-source.mjs';
if(process.env.NEO_LOCAL_AUTH==='true')throw Error('Remove NEO_LOCAL_AUTH; this command creates an isolated localhost-only build.');
// Desktop synchronization can duplicate large generated trees. Keep builds
// in a local cache, separated by source digest; durable business state stays
// in the existing project runtime directory.
const root=process.cwd(),source=await stableSource(root),cache=path.join(homedir(),'Library/Caches/neo-local-stable'),generation=randomUUID(),build=path.join(cache,`${source.digest}-${generation}`);
const version=`neo-local-${source.digest.slice(0,12)}`;
await mkdir(path.dirname(build),{recursive:true});
// Each completed build is immutable: a concurrent rebuild must never replace
// assets beneath a running server that has already imported the old modules.
await mkdir(build);
for(const p of ['app','components','lib','server','worker','public','.openai','db','drizzle','vite.config.ts','package.json','package-lock.json','tsconfig.json','postcss.config.mjs'])await cp(path.join(root,p),path.join(build,p),{recursive:true});
// The homepage pins the same reference knowledge version as the Python agent.
// Copy only the public catalog, never the service environment or runtime state.
await mkdir(path.join(build,'agent-service/neo_agent'),{recursive:true});
await cp(path.join(root,'agent-service/neo_agent/business-knowledge.json'),path.join(build,'agent-service/neo_agent/business-knowledge.json'));
await symlink(path.join(root,'node_modules'),path.join(build,'node_modules'),'dir');
process.chdir(build);
await(await createBuilder({cacheDir:path.join(build,'.cache/vite'),define:{__NEO_LOCAL_CONFIG__:JSON.stringify({enabled:true,development:true,userId:'local-owner'})}})).buildApp();
await writeFile(path.join(build,'source-manifest.json'),JSON.stringify({version,status:'local_candidate',root,createdAt:new Date().toISOString(),localOnly:true,...source},null,2)+'\n');
const pointer=path.join(cache,`${source.digest}.json`),temporary=pointer+`.${generation}.tmp`;
await writeFile(temporary,JSON.stringify({build,digest:source.digest})+'\n');await rename(temporary,pointer);
console.log('原 /demo 的本地稳定构建已生成：'+build+'；正式生产 dist 未替换。');
