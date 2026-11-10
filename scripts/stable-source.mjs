import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
export async function stableSource(root=process.cwd()){
 const files=[];
 async function walk(rel){for(const e of await readdir(path.join(root,rel),{withFileTypes:true})){const p=path.join(rel,e.name);if(['node_modules','.venv','__pycache__','state','.pytest_cache','outputs'].includes(e.name)||e.name.startsWith('.env'))continue;if(e.isDirectory())await walk(p);else if(e.isFile()&&!/\.(sqlite|db|pyc|log)$/.test(p))files.push(p);}}
 for(const p of ['app','components','lib','server','worker','public','scripts','db','drizzle','agent-service/neo_agent'])await walk(p);
 files.push('vite.config.ts','package.json','package-lock.json','.openai/hosting.json','tsconfig.json','postcss.config.mjs');
 const rows=[];for(const p of files.sort())rows.push({path:p,sha256:createHash('sha256').update(await readFile(path.join(root,p))).digest('hex')});
 return {digest:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),files:rows};
}
