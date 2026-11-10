import {startKnowledgeMonitorPump,initializeAcceptanceMonitoring} from '../server/knowledge-monitor.ts';
import {readIncomingBody} from './local-request-body.mjs';
import {startBusinessUpdatePump} from '../server/business-update-pump.ts';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {stableSource} from './stable-source.mjs';
import {localRuntime} from './local-runtime.mjs';
import {handleApi} from '../server/api.ts';
const root=process.cwd(),out=path.resolve(root,process.env.NEO_LOCAL_OUTPUT||'outputs/stable-local'),current=await stableSource(root),cache=path.join(homedir(),'Library/Caches/neo-local-stable');
if(!out.startsWith(path.join(root,'outputs')+path.sep))throw Error('本地交付状态必须保存在当前项目 outputs 内');
let build=path.join(cache,current.digest);
try{const pointer=JSON.parse(await readFile(path.join(cache,`${current.digest}.json`)));if(pointer.digest!==current.digest||typeof pointer.build!=='string'||!path.resolve(pointer.build).startsWith(cache+path.sep))throw Error('本地构建索引无效');build=pointer.build;}catch(e){if(e.code!=='ENOENT')throw e;}
const compiled=JSON.parse(await readFile(path.join(build,'source-manifest.json')));
if(compiled.digest!==current.digest)throw Error('源码已变化，请先 npm run build:local:stable，再启动此版本。');
const seed=JSON.parse(await readFile(path.join(out,'simulation.json'))),port=Number(process.env.NEO_WEB_PORT||3102),agentPort=Number(process.env.NEO_AGENT_PORT||8138),mode=process.env.NEO_EXECUTION_MODE||'live',manualChat=mode==='live'&&process.env.NEO_MANUAL_CHAT!=='false';
const manualMarket=manualChat&&process.env.NEO_MARKET_RESEARCH==='true';
if(!['offline','live'].includes(mode))throw Error('NEO_EXECUTION_MODE must be offline or live');
if(manualChat&&mode!=='live')throw Error('手动对话需使用已配置模型的运行模式');
for(const p of [port,agentPort]){if(!Number.isInteger(p)||p<1024||p>65535)throw Error('Invalid local port');const check=createServer();await new Promise((ok,no)=>{check.once('error',no);check.listen(p,'127.0.0.1',ok);});await new Promise(r=>check.close(r));}
const token=randomBytes(32).toString('hex');await mkdir(path.join(out,'agent'),{recursive:true});
// Local encrypted configuration master key survives restarts in this isolated output.
const keyFile=path.join(out,'.control-encryption-key');let encryptionKey=process.env.NEO_CONFIG_ENCRYPTION_KEY;
if(!encryptionKey){try{encryptionKey=(await readFile(keyFile,'utf8')).trim();}catch{encryptionKey=randomBytes(32).toString('hex');await writeFile(keyFile,encryptionKey,{mode:0o600});}}
const controlUrl='http://127.0.0.1:'+port;
let integrationEnv={};try{const x=JSON.parse(await readFile(path.join(out,'integrations/config.json'),'utf8'));integrationEnv={NEO_OPENMETADATA_URL:x.openmetadataUrl,NEO_OPENMETADATA_TOKEN:x.openmetadataToken};}catch(e){if(e.code!=='ENOENT')throw e;}
const agent=spawn(path.join(root,'agent-service/.venv/bin/python'),['-m','uvicorn','neo_agent.app:app','--app-dir','agent-service','--host','127.0.0.1','--port',String(agentPort)],{cwd:root,stdio:'inherit',env:{...process.env,...integrationEnv,NEO_SERVICE_TOKEN:token,NEO_CONTROL_URL:controlUrl,NEO_AGENT_DB:path.join(out,'agent/agent.sqlite'),NEO_MARKET_CACHE:path.join(out,'agent/market-cache.sqlite'),NEO_AUTO_PATROL:'false',NEO_AGENT_RESERVED_INTERACTIVE:'true',NEO_AGENT_EXECUTION_MODE:mode,...(mode==='offline'?{LLM_API_KEY:'',LLM_MODEL:''}:{}),...(mode==='offline'||manualChat&&!manualMarket?{TAVILY_API_KEY:'',NEO_MARKET_PROVIDER:'disabled',NEO_FIRECRAWL_MCP_COMMAND:''}:{})}});
agent.on('error',e=>{console.error(e);process.exitCode=1;});
// Miniflare also installs process exit handlers; never leave our child behind.
process.on('exit',()=>{if(agent.exitCode===null)agent.kill('SIGTERM');});
const {mf,runtime:base}=await localRuntime({persistRoot:path.join(out,'runtime')});
const runtime={...base,NEO_CONFIG_ENCRYPTION_KEY:encryptionKey,NEO_CONTROL_URL:controlUrl,knowledgeMonitorEnabled:process.env.NEO_KNOWLEDGE_MONITOR!=='false',automaticMonitorBusinesses:process.env.NEO_AUTOMATIC_MONITOR_BUSINESSES?process.env.NEO_AUTOMATIC_MONITOR_BUSINESSES.split(',').map(x=>x.trim()).filter(Boolean):['neo-sim-acceptance-20261004'],agentExecutionMode:mode,offlineAgentInteractive:false,manualAgentBusinesses:manualChat?(seed.businessIds??[seed.businessId]):[],manualMarketBusinesses:manualMarket?(seed.businessIds??[seed.businessId]):[],NEO_AGENT_URL:'http://127.0.0.1:'+agentPort,NEO_OFFLINE_AGENT_URL:'http://127.0.0.1:'+agentPort,NEO_SERVICE_TOKEN:token};
const updatePump=startBusinessUpdatePump(runtime);
if(process.env.NEO_KNOWLEDGE_MONITOR!=='false'&&process.env.NEO_MONITOR_ACCEPTANCE!=='false')await initializeAcceptanceMonitoring(runtime,seed.businessId,seed.dataNature??'demo');
const knowledgePump=process.env.NEO_KNOWLEDGE_MONITOR==='false'?{stop:async()=>{}}:startKnowledgeMonitorPump(runtime);
const monitorSubscription=await runtime.DB.prepare('SELECT enabled FROM neo_monitor_subscriptions WHERE business_id=? AND data_nature=?').bind(seed.businessId,seed.dataNature??'demo').first();
const automaticMonitoringEnabled=mode==='live'&&runtime.knowledgeMonitorEnabled&&runtime.automaticMonitorBusinesses.includes(seed.businessId)&&monitorSubscription?.enabled===1;
const {default:worker}=await import(pathToFileURL(path.join(build,'dist/server/index.js')));
const assets=async request=>{const pathname=decodeURIComponent(new URL(request.url).pathname),target=path.resolve(build,'dist/client','.'+pathname);if(!target.startsWith(path.join(build,'dist/client')+path.sep))return new Response('Forbidden',{status:403});try{const bytes=await readFile(target),type={'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.json':'application/json'}[path.extname(target)]||'application/octet-stream';return new Response(bytes,{headers:{'content-type':type}});}catch{return new Response('Not found',{status:404});}};
const requests=[];let stopping=false;
const server=createServer(async(req,res)=>{try{const bytes=await readIncomingBody(req);const url='http://127.0.0.1:'+port+req.url;const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:bytes}:{})});let response;
 if(req.url==='/__neo_version')response=Response.json({version:compiled.version,sourceDigest:current.digest,executionMode:mode,manualChatEnabled:manualChat,agentBudgetPolicy:'unlimited',autoPatrolEnabled:false,automaticMonitoringEnabled,automaticAssessmentEnabled:automaticMonitoringEnabled,marketSearchEnabled:manualChat?manualMarket:mode!=='offline',seed});
 else if(req.url.startsWith('/api/'))response=await handleApi(request,runtime);
 else if(req.url.startsWith('/_next/')&&!req.url.includes('rsc'))response=await assets(request);
 else response=await worker.fetch(request,{ASSETS:{fetch:assets}},{waitUntil(){},passThroughOnException(){}});
 requests.push({at:new Date().toISOString(),path:req.url,method:req.method,status:response.status});if(requests.length>1000)requests.shift();res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 await writeFile(path.join(out,'requests.json'),JSON.stringify(requests,null,2));
 }catch(e){const status=e.status===413?413:500;if(status===500)console.error(e);requests.push({path:req.url,method:req.method,status,error:String(e)});res.writeHead(status);res.end(status===413?'请求超过本地入口字节上限。':'本地服务请求失败，请检查日志。');}});
await new Promise(r=>server.listen(port,'127.0.0.1',r));
const entry=new URL('/demo','http://127.0.0.1:'+port);entry.searchParams.set('businessId',seed.businessId);entry.searchParams.set('dataNature','demo');if(seed.snapshotId)entry.searchParams.set('snapshotId',seed.snapshotId);
const info={version:compiled.version,sourceDigest:current.digest,build,pid:process.pid,agentPid:agent.pid,port,agentPort,executionMode:mode,manualChatEnabled:manualChat,agentBudgetPolicy:'unlimited',autoPatrolEnabled:false,automaticMonitoringEnabled,automaticAssessmentEnabled:automaticMonitoringEnabled,marketSearchEnabled:manualChat?manualMarket:mode!=='offline',root,originalDatabaseTouched:false,url:entry.href};
await writeFile(path.join(out,'runtime.json'),JSON.stringify(info,null,2)+'\n');console.log(JSON.stringify(info));
async function stop(){if(stopping)return;stopping=true;server.close();server.closeAllConnections();await updatePump.stop();await knowledgePump.stop();const exited=new Promise(resolve=>agent.once('exit',resolve));agent.kill('SIGTERM');await writeFile(path.join(out,'requests.json'),JSON.stringify(requests,null,2));await mf.dispose();if(agent.exitCode===null)await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,5000))]);if(agent.exitCode===null)agent.kill('SIGKILL');process.exit();}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,stop);
agent.once('exit',code=>{if(!stopping){console.error('Agent 服务退出：'+code);void stop();}});
