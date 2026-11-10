import type {Runtime} from './store.ts';
// Worker bindings only: browser headers, URL and payload never configure execution.
export function configuredRuntime(bindings:Record<string,unknown>,local?:Runtime['local']):Runtime{
 const raw=bindings.NEO_AGENT_EXECUTION_MODE??'live';
 const agentExecutionMode=raw==='live'||raw==='offline'||raw==='disabled'?raw:'disabled';
 return {...bindings,local,trustSitesIdentity:bindings.NEO_TRUST_SITES_IDENTITY==='true',
  agentExecutionMode,NEO_OFFLINE_AGENT_URL:typeof bindings.NEO_OFFLINE_AGENT_URL==='string'?bindings.NEO_OFFLINE_AGENT_URL:undefined,
  offlineAgentInteractive:bindings.NEO_OFFLINE_AGENT_INTERACTIVE!=='false',
  manualAgentBusinesses:typeof bindings.NEO_MANUAL_AGENT_BUSINESSES==='string'?bindings.NEO_MANUAL_AGENT_BUSINESSES.split(',').map(x=>x.trim()).filter(Boolean):[],
  manualMarketBusinesses:typeof bindings.NEO_MANUAL_MARKET_BUSINESSES==='string'?bindings.NEO_MANUAL_MARKET_BUSINESSES.split(',').map(x=>x.trim()).filter(Boolean):[],
  knowledgeMonitorEnabled:bindings.NEO_KNOWLEDGE_MONITOR!=='false',
  automaticMonitorBusinesses:typeof bindings.NEO_AUTOMATIC_MONITOR_BUSINESSES==='string'?bindings.NEO_AUTOMATIC_MONITOR_BUSINESSES.split(',').map(x=>x.trim()).filter(Boolean):[],
  disableAutomaticPatrol:bindings.NEO_DISABLE_AUTOMATIC_PATROL==='true'||bindings.NEO_AUTO_PATROL==='false'||agentExecutionMode!=='live',
  isolatedAgentBusinesses:typeof bindings.NEO_ISOLATED_AGENT_BUSINESSES==='string'?bindings.NEO_ISOLATED_AGENT_BUSINESSES.split(',').map(x=>x.trim()).filter(Boolean):[] } as Runtime;
}
