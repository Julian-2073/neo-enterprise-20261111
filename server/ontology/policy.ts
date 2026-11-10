import type {Definition} from './model.ts';
import {neoDefinition} from './model.ts';
const roles=['conversion','supply','market','joint','orchestrator'];
const types:Record<string,string[]>={conversion:['product','sku','role','channel','order','order_line','refund','event','expense'],supply:['product','sku','role','warehouse','inventory','arrival','order','order_line','refund'],market:['product','sku','role','channel','expense','event','market_evidence']};
export function agentPolicy(d:Definition){return {version:'ontology-policy-v2',definitionId:d.version,readScope:'enterprise_pinned_view',writes:'none',roles:Object.fromEntries(roles.map(role=>{
 const permitted=role==='joint'||role==='orchestrator'?neoDefinition().types.map(t=>t.id):types[role];
 const access=Object.fromEntries(d.types.map(t=>[t.id,d.agentAccess?.[t.id]?d.agentAccess[t.id].roles.includes(role)?d.agentAccess[t.id].properties:[]:permitted.includes(t.id)?Object.keys(t.properties):[]]).filter(([,p])=>(p as string[]).length));
 return [role,{tools:['describe_business','read_business','query_objects','read_specialists',...(['market','joint','orchestrator'].includes(role)?['read_decisions','search_market']:[]),'forecast','simulate_scenario',...(role==='orchestrator'?['read_operating_plan','optimize_operating_plan']:[])],types:access}];}))};}
