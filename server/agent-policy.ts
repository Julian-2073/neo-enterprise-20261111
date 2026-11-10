import type {Runtime} from './store.ts';
import {assert,ApiError} from './errors.ts';
export type AgentPolicy={automaticPatrolAllowed:boolean;interactiveAllowed:boolean;isolated:boolean;manualModelAllowed:boolean;marketSearchAllowed:boolean;notice:string|null};
export function agentPolicy(runtime:Runtime,businessId:string):AgentPolicy{
 const isolated=businessId.startsWith('neo-sim-')||(runtime.isolatedAgentBusinesses??[]).includes(businessId);
 const mode=runtime.agentExecutionMode??'live';
 const manualModelAllowed=mode==='live'&&(runtime.manualAgentBusinesses??[]).includes(businessId);
 const interactiveAllowed=mode==='offline'?!!runtime.NEO_OFFLINE_AGENT_URL&&runtime.offlineAgentInteractive!==false:mode==='live'&&(!isolated||manualModelAllowed);
 const automaticPatrolAllowed=interactiveAllowed&&mode==='live'&&!runtime.disableAutomaticPatrol&&!isolated;
 const marketSearchAllowed=interactiveAllowed&&mode==='live'&&(!isolated||(runtime.manualMarketBusinesses??[]).includes(businessId));
 return {isolated,manualModelAllowed,interactiveAllowed,automaticPatrolAllowed,marketSearchAllowed,notice:!interactiveAllowed?'当前为离线查看模式，可以查看已保存资料；手动对话需由服务端开启。':isolated&&manualModelAllowed?(marketSearchAllowed?'当前使用模拟经营资料；可手动审查和检索行业原文，自动巡检已关闭。':'当前使用模拟经营资料；可手动提问，自动巡检与外部市场检索已关闭。'):!automaticPatrolAllowed?'本企业已关闭自动巡检；已有结论仍可查看。':null};
}
export function requireAgentExecution(runtime:Runtime,businessId:string,purpose?:string){
 const policy=agentPolicy(runtime,businessId);
 assert(policy.interactiveAllowed,403,'AGENT_EXECUTION_DISABLED',policy.notice!);
 assert(purpose!=='patrol'||policy.automaticPatrolAllowed,403,'PATROL_DISABLED','本企业已关闭自动巡检；不能从页面或请求参数重新开启。');
}
export function offlineAgentBase(runtime:Runtime){
 const value=runtime.NEO_OFFLINE_AGENT_URL;
 assert(value,503,'OFFLINE_AGENT_UNAVAILABLE','离线分析服务未连接');
 let url:URL;try{url=new URL(value);}catch{throw new ApiError(503,'OFFLINE_AGENT_UNAVAILABLE','离线分析服务地址无效');}
 assert(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&!url.username&&!url.password&&!['3000','8127',''].includes(url.port)&&url.pathname==='/'&&!url.search&&!url.hash,503,'OFFLINE_AGENT_UNAVAILABLE','离线分析仅允许独立本机端口，不能连接原服务或外部地址');
 return url.origin;
}

// Narrow server-authorized exception for the new monitor only. It never
// changes isolated, manual market permissions or any business-action authority.
export function automaticMonitorAllowed(runtime:Runtime,businessId:string){
 return runtime.knowledgeMonitorEnabled!==false&&(runtime.agentExecutionMode??'live')==='live'&&(!agentPolicy(runtime,businessId).isolated||(runtime.automaticMonitorBusinesses??[]).includes(businessId));
}
