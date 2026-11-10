import {localRuntime} from './local-runtime.mjs';
import {startBusinessUpdatePump} from '../server/business-update-pump.ts';
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
// Local-only development launcher. No model or search keys are copied to browser code.
const port=process.env.NEO_WEB_PORT||'3000',agentPort=process.env.NEO_AGENT_PORT||'8127';
const envPath=resolve('agent-service/.env');let text='';try{text=await readFile(envPath,'utf8');}catch{/* An absent local configuration uses defaults. */}
let token=text.match(/^NEO_SERVICE_TOKEN=(.+)$/m)?.[1];if(!token){token=randomBytes(32).toString('hex');await writeFile(envPath,text+`\nNEO_SERVICE_TOKEN=${token}\n`,{mode:0o600});}
let vars='';try{vars=await readFile('.dev.vars','utf8');}catch{/* An absent local configuration uses defaults. */}
vars=vars.replace(/^NEO_AGENT_URL=.*\n?/gm,'').replace(/^NEO_SERVICE_TOKEN=.*\n?/gm,'');
await writeFile('.dev.vars',vars+`\nNEO_AGENT_URL=http://127.0.0.1:${agentPort}\nNEO_SERVICE_TOKEN=${token}\n`,{mode:0o600});
const children=[];const run=(cmd,args,extra={})=>{const p=spawn(cmd,args,{stdio:'inherit',env:{...process.env,...extra}});children.push(p);return p;};
const setup=run(process.execPath,['scripts/setup-local.mjs']);await new Promise((resolve,reject)=>setup.on('exit',n=>n?reject(Error('本地迁移失败')):resolve()));
run('agent-service/.venv/bin/python',['-m','uvicorn','neo_agent.app:app','--app-dir','agent-service','--host','127.0.0.1','--port',agentPort],{NEO_SERVICE_TOKEN:token});
run(process.execPath,['node_modules/vinext/dist/cli.js','dev','--host','127.0.0.1','--port',port],{NEO_LOCAL_AUTH:'true'});
const {mf,runtime:base}=await localRuntime({persist:true});
const pump=startBusinessUpdatePump({...base,NEO_AGENT_URL:'http://127.0.0.1:'+agentPort,NEO_SERVICE_TOKEN:token,disableAutomaticPatrol:true,agentExecutionMode:'live'});
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(stopping)return;stopping=true;for(const p of children)p.kill(signal);await pump.stop();await mf.dispose();process.exit();});
console.log(`NEO 本地入口：http://127.0.0.1:${port}；模型与检索需在 agent-service/.env 配置。`);
