import {activePlatformSettings} from './platform-settings.ts';
import {salesForecastSummary} from '../lib/business-forecast.ts';
import {currentBusinessGeneration} from './business-head.ts';
import type {Context} from './auth.ts';
import {requireWrite} from './auth.ts';
import {all,first} from './store.ts';
import {assert,json,ApiError} from './errors.ts';
import {agentBody,readOperatingRun,handleAgents,queueOperatingBrain,readOperatingBrains} from './agents.ts';
import {handlePolicyBriefing} from './policy-briefing.ts';
import {agentPolicy} from './agent-policy.ts';
import {loadGeneration} from './generation-storage.ts';
import {operatingReviews} from './business-reviews.ts';
import {loadBusinessArtifact} from './business-artifact-storage.ts';
import {createScenarioBundle} from './business-scenarios.ts';
import {getOperatingDecision,saveOperatingDecision} from './business-decisions.ts';
import {generationSnapshot,generationDomain,generationState,generationJourney,generationWeeks,projectedHome,projectedRun,projectedForecast,projectedScenario,projectedMarketReview,reviewResult,legacyScenario,baselineId,canonicalId} from './workbench-projection.ts';
import {marketWorkbench} from './market-workbench.ts';
import {modelMarketPresentation,marketDisplayMetrics} from './market-review.ts';
import {homeSections,supplyOverview} from './home-sections.ts';
import {decisionWorkbench} from './decision-workbench.ts';
import {plusDays,completeCoverage} from '../lib/business-metrics.ts';
import type {OperatingGeneration} from './business-generations.ts';
import type {ScenarioSpec,ScenarioResult as ComputedScenario} from '../lib/business-scenarios.ts';
import type {AgentRun,DecisionRecord,ScenarioInput} from './agent-contracts.ts';
import type {Metric} from '../lib/business-metrics.ts';
import type {OperatingEvidenceResponse} from '../components/neo-demo/operating-evidence-drawer.tsx';

const resources=new Set(['policy-briefing','operating-snapshot','agent-domain','agent-policy','customer-journey','home-decision','growth-reviews','home-sections','supply-overview','market-workbench','decision-workbench','forecasts','scenarios','decisions','agent-runs','evidence']);
type Bundle={id:string;generationId:string;scenarios:ScenarioSpec[];results:ComputedScenario[]};
async function bundles(ctx:Context,nature:string,g:OperatingGeneration){const rows=await all<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE business_id=? AND data_nature=? AND snapshot_id=? AND kind='business_scenario_bundle' ORDER BY created_at DESC LIMIT 20",ctx.businessId,nature,g.id);const values=await Promise.all(rows.map(r=>loadBusinessArtifact<Bundle&{forecastJobId?:string}>(ctx,nature,'business_scenario_bundle',r.payload)));return values.filter(b=>!b.forecastJobId);}
export async function compatibilityDecisions(ctx:Context,nature:string,g:OperatingGeneration):Promise<DecisionRecord[]>{
 const rows=await all<{id:string}>(ctx.db,"SELECT id FROM neo_artifacts WHERE business_id=? AND data_nature=? AND snapshot_id=? AND kind='business_decision' ORDER BY created_at DESC LIMIT 30",ctx.businessId,nature,g.id);
 const decisions=await Promise.all(rows.map(r=>getOperatingDecision(ctx,nature,r.id)));return decisions.filter(d=>!d.forecastJobId).map(d=>{const selected=projectedScenario(g,d.forecast,d.scenario,d.bundleId);return {id:d.id,scenarioId:`${d.bundleId}~${d.scenario.id}`,reason:d.reason??'已保存经营选择',plan:d.plan??null,snapshotId:g.id,createdAt:d.createdAt,title:d.title??d.scenario.name,selectedScenario:selected,resultStatus:selected?'ready':'unavailable',resultNotice:selected?null:'原方案计算资料不足'};});
}
async function latestRun(ctx:Context,nature:string,g:OperatingGeneration,started?:AgentRun){
 const selected=await operatingReviews(ctx,nature,g.id),id=started?.id??selected.runId;if(!id)return null;
 const run=await readOperatingRun(ctx,nature,g.id,id);
 const completeId='completeRunId' in selected?selected.completeRunId:null;
 const completeRun=completeId&&completeId!==run.id?await readOperatingRun(ctx,nature,g.id,completeId):run.status==='completed'&&run.configurationFreshness?.status!=='stale'?run:null;
 return {...run,completeRun,result:run.status!=='completed'&&completeRun?.result?{...completeRun.result,displayOnly:true,displaySourceRunId:completeRun.id,checkpointResult:run.result}:run.result};
}
function specialist(g:OperatingGeneration,run:AgentRun|null,role:string){const r=reviewResult(run)?.[role];return r&&r.status!=='disabled'?{title:r.headline,summary:r.explanation,evidenceIds:[`${g.id}:view:review:${role}`],runId:`${run!.id}~${role}`}:null;}
export function compatibilityMarket(g:OperatingGeneration,run:AgentRun|null){
 const s=generationSnapshot(g),d=generationDomain(g),candidates=run?.result?.marketEvidence??[],base=marketWorkbench(s,d.facts,d,candidates);
 // Override period calculations with the canonical registry, including absent
 // expected feeds and unallocated expense. Never divide behaviour by customers.
 const read=(p:{start:string;end:string},channel?:string)=>{const rows=channel?g.state.inputs.filter(r=>r.channelId===channel):g.state.inputs,state=generationState(g,p.start,p.end,rows),m=state.metrics;const hasUnallocated=!!channel&&g.state.inputs.some(r=>r.kind==='expense'&&!r.channelId&&r.businessDate>=p.start&&r.businessDate<=p.end);const orders=m.paidOrders.value,spend=hasUnallocated?null:m.spendCents.value;const intent=completeCoverage(state.coverage,'event',p.start,p.end,g.state.profile.expectedSources.filter(x=>x.kinds.includes('event')).map(x=>x.sourceId))?rows.filter(r=>r.kind==='event'&&r.stage==='A3'&&r.businessDate>=p.start&&r.businessDate<=p.end).reduce((n,r)=>n+(r.quantity??0),0):null;return {intent,paidOrders:orders,netRevenueCents:m.netRevenueCents.value,spendCents:spend,costPerOrderCents:orders!=null&&orders>0&&spend!=null?spend/orders:null};};
 const change=(a:number|null,b:number|null)=>a!=null&&b!=null&&b>0?a/b-1:null;
 for(const row of [...base.cells,...base.channels]){row.current=read(base.periods.current,row.channel);row.previous=base.periods.previous?read(base.periods.previous,row.channel):null;row.changes={intent:change(row.current.intent,row.previous?.intent??null),paidOrders:change(row.current.paidOrders,row.previous?.paidOrders??null),netRevenue:change(row.current.netRevenueCents,row.previous?.netRevenueCents??null),spend:change(row.current.spendCents,row.previous?.spendCents??null),costPerOrder:change(row.current.costPerOrderCents,row.previous?.costPerOrderCents??null)};row.headline=row.current.paidOrders==null?'资料不足':`${row.current.paidOrders} 笔订单`;row.summary='按同一渠道核算，尚未配置商品角色，不分摊费用或推断竞品影响。';}
 const current=read(base.periods.current),previous=base.periods.previous?read(base.periods.previous):null;
 base.signals[0].delta=change(current.intent,previous?.intent??null);base.signals[2].delta=change(current.costPerOrderCents,previous?.costPerOrderCents??null);
 for(const signal of base.signals.filter(x=>x.id!=='competition'))signal.value=signal.delta==null?'—':`${signal.delta>0?'+':''}${(signal.delta*100).toFixed(1)}%`;
 const model=projectedMarketReview(g,run),presented=modelMarketPresentation(base,model,candidates);
 presented.signals=presented.signals.map(signal=>({...signal,title:signal.id==='competition'?(presented.sources.length?'查看已筛选原文':'暂无可用竞品原文'):signal.id==='demand'?'内部意向变化':'每笔订单投入变化',summary:signal.note}));
 presented.cells=presented.cells.map((c,i)=>({...c,headline:base.cells[i].headline,summary:base.cells[i].summary,displayMetrics:marketDisplayMetrics(c)}));
 return {...presented,run:projectedRun(g,run,'market'),canGenerate:false};
}
export function compatibilitySections(g:OperatingGeneration,run:AgentRun|null){
 const s=generationSnapshot(g),goods=supplyOverview(s,specialist(g,run,'supply'));
 const hotel=g.state.profile.industry==='hotel',unit=g.baseline.unit;
 const capacity=hotel?g.state.inputs.filter(r=>r.kind==='hotel_capacity'&&r.businessDate>g.state.asOf&&r.businessDate<=plusDays(g.state.asOf,g.state.profile.horizonDays)):[];
 const stock=g.state.metrics.sellableUnits?.value??null;goods.metrics.sellableUnits=stock;
 const weeks=generationWeeks(g);goods.labels=weeks.map(w=>`${w.start.slice(5)}–${w.end.slice(5)}`);goods.weeks=weeks.map(w=>({start:w.start,evidenceId:`${g.id}:view:supply-pulse:${w.start}`}));
 const stockValues=weeks.map(w=>generationState({...g,state:{...g.state,asOf:w.end}},w.start,w.end).metrics.sellableUnits?.value??null);
 goods.series=[{id:'sellable',name:hotel?'历史房晚能力未登记':'可售库存',color:'#2678e8',values:hotel?weeks.map(()=>null):stockValues}];
 goods.display={title:hotel?'房晚按日核查':'可售库存变化',unit,metricLabel:hotel?'库存不适用':'当前可售',secondaryLabel:hotel?'预测期登记房晚':'待承接',secondaryValue:hotel?(capacity.length?capacity.reduce((n,r)=>n+(r.quantity??0),0):null):g.baseline.totals.unmet,max:Math.max(1,...stockValues.filter((n):n is number=>n!=null))*1.2};
 goods.evidenceId=`${g.id}:view:supply`;goods.note=hotel?'房晚按日期核算，不能跨日结转；登记能力不等于可承接入住。':'实际可售扣除占用与待检；未登记供给目标，不计算达标率。';
 return homeSections(s,{journey:generationJourney(g),review:specialist(g,run,'conversion')},goods,compatibilityMarket(g,run));
}
const labels:Record<string,string>={netRevenueCents:'净成交额',spendCents:'经营投入',contributionMarginCents:'贡献毛利',variableCostCents:'可变成本',paidOrders:'支付订单',fulfilledUnits:'净支付数量',sellableUnits:'可售库存',inventoryCostCents:'库存成本货值',A1Customers:'了解客户',A2Customers:'互动客户',A3Customers:'意向客户',A4Customers:'购买客户'};
function metricLabel(g:OperatingGeneration,key:string){return key==='fulfilledUnits'&&g.state.profile.industry==='hotel'?'已入住房晚':labels[key]??key;}
function evidenceMetrics(g:OperatingGeneration,m:Record<string,Metric>,keys:string[]){return keys.map(k=>({label:metricLabel(g,k),value:m[k]?.value??null,unit:m[k]?.unit??g.baseline.unit}));}
export function compatibilityEvidence(g:OperatingGeneration,id:string,run:AgentRun|null,url:URL,scenario?:ComputedScenario):OperatingEvidenceResponse{
 const prefix=`${g.id}:view:`;assert(id.startsWith(prefix),404,'EVIDENCE_SCOPE','证据不属于当前经营代次');
 const suffix=id.slice(prefix.length),parts=suffix.split(':').map(decodeURIComponent);const supported=['metric','customer-journey','customer-pulse','supply','supply-pulse','inventory','review','market-channel','channel-role','market-demand','market-efficiency','market-source','forecast','forecast-week','week'];assert(supported.includes(parts[0]),404,'EVIDENCE','证据类型不存在');
 let state=g.state,rows=g.state.inputs,keys=['paidOrders','netRevenueCents','contributionMarginCents'],title='当前经营依据',period=g.state.period,observations:string[]=[],formula='同一冻结资料版本，按已确认完整性和指标规则计算。';
 const role=['market-channel','channel-role','market-demand','market-efficiency','market-source'].includes(parts[0])?'market':['inventory','supply','supply-pulse'].includes(parts[0])?'supply':['customer-journey','customer-pulse'].includes(parts[0])?'conversion':parts[1]&&parts[0]==='review'?parts[1]:'joint';
 const review=reviewResult(run)?.[role];
 if(parts[0]==='metric'){assert(Object.hasOwn(state.metrics,parts[1]),404,'EVIDENCE','指标不存在');keys=[parts[1]];title=metricLabel(g,parts[1]);}
 if(['customer-pulse','supply-pulse','week'].includes(parts[0])){const week=generationWeeks(g).find(w=>w.start===parts[1]);assert(week,404,'EVIDENCE','经营周不存在');period={start:week.start,end:week.end};state=parts[0]==='supply-pulse'?generationState({...g,state:{...g.state,asOf:week.end}},week.start,week.end):week.state;rows=rows.filter(r=>parts[0]==='supply-pulse'?r.businessDate<=period.end:r.businessDate>=period.start&&r.businessDate<=period.end);title='当周经营变化';}
 if(role==='conversion'){keys=stagesKeys();formula=generationJourney(g).limitations.join('；');title='4A 客户旅程';}
 if(parts[0]==='week'&&parts[2]){keys=[parts[2]];assert(Object.hasOwn(state.metrics,parts[2]),404,'EVIDENCE','周指标不存在');}
 if(role==='supply'){keys=['sellableUnits','inventoryCostCents'];rows=rows.filter(r=>['inventory','arrival','fulfillment_rule','material_inventory','bom','production_capacity','production','hotel_capacity','hotel_reservation'].includes(r.kind));title=g.state.profile.industry==='hotel'?'房晚与可售能力':'供给与库存';}
 if(parts[0]==='inventory'){assert(generationDomain(g).products.some(p=>p.id===parts[1]),404,'EVIDENCE','商品不存在');rows=rows.filter(r=>r.entityId===parts[1]);state=generationState(g,period.start,period.end,rows);title=parts[1]+' · 库存依据';}
 if(['market-channel','channel-role'].includes(parts[0])){assert(generationDomain(g).channels!.some(c=>c.id===parts[1]),404,'EVIDENCE','渠道不存在');if(parts[0]==='channel-role')assert(parts[2]==='unassigned',404,'EVIDENCE','未登记的货盘角色');rows=rows.filter(r=>r.channelId===parts[1]);state=generationState(g,period.start,period.end,rows);title=parts[1]+' · 渠道对照';}
 if(['market-channel','channel-role'].includes(parts[0])&&g.state.inputs.some(r=>r.kind==='expense'&&!r.channelId&&r.businessDate>=period.start&&r.businessDate<=period.end)){state={...state,metrics:{...state.metrics,spendCents:{...state.metrics.spendCents,value:null},contributionMarginCents:{...state.metrics.contributionMarginCents,value:null}}};observations.push('存在未归属渠道的投入；不分摊费用，不计算渠道贡献毛利。');}
 let metrics=evidenceMetrics(g,state.metrics,keys),externalSources:OperatingEvidenceResponse['externalSources']=[];
 if(parts[0]==='customer-pulse'){const i=generationWeeks(g).findIndex(w=>w.start===period.start),previous=generationWeeks(g)[i-1];observations=stagesKeys().map(k=>{const a=state.metrics[k]?.value,b=previous?.state.metrics[k]?.value;return `${labels[k]}：本周 ${a??'资料不足'}，上周 ${b??'资料不足'}${a!=null&&b!=null?`，变化 ${a-b>0?'+':''}${a-b} 人`:''}`;});if(previous)rows=g.state.inputs.filter(r=>r.businessDate>=previous.start&&r.businessDate<=period.end&&['event','order','hotel_stay'].includes(r.kind));}
 if(parts[0]==='customer-journey'){const journey=generationJourney(g);metrics=[...metrics,...journey.period.transitions.map(t=>({label:`${t.from} → ${t.to}`,value:t.rate,unit:'比例'}))];observations=journey.period.transitions.map(t=>t.reason??`${t.from} 已完成观察 ${t.matureCustomers} 人，进入 ${t.to} ${t.convertedCustomers} 人`);}
 if(parts[0]==='market-source'){const source=run?.result?.marketEvidence?.find(s=>s.id===parts[1]&&s.verificationStatus==='source_read'&&review?.selectedSourceIds?.includes(s.id));assert(source,404,'EVIDENCE','原文未被本代次智能体核验选取');externalSources=[{...source,publisher:new URL(source.url).hostname}];title=source.title;observations=[source.excerpt??'原文摘要尚未保存'];rows=[];metrics=[];}
 if(['forecast','forecast-week'].includes(parts[0])){const f=scenario??g.baseline;title='约束预测依据';metrics=[{label:'预计履约',value:f.totals.fulfilled,unit:f.unit},{label:'待承接',value:f.totals.unmet,unit:f.unit},{label:'贡献毛利',value:f.totals.contributionMarginCents,unit:'人民币分'}];formula='按已录支付或入住节奏，叠加实际登记的仓库、房晚或物料产能约束；不代表潜在需求。';observations=[...f.feasibility.reasons,...f.assumptions];if(parts[0]==='forecast-week'){const start=parts[2];assert(f.points.some(p=>p.date===start),404,'EVIDENCE','预测周不存在');period={start,end:plusDays(start,6)>plusDays(g.state.asOf,g.state.profile.horizonDays)?plusDays(g.state.asOf,g.state.profile.horizonDays):plusDays(start,6)};const points=f.points.filter(p=>p.date>=period.start&&p.date<=period.end);metrics=[{label:'预计履约',value:points.reduce((n,p)=>n+p.fulfilled,0),unit:f.unit},{label:'待承接',value:points.reduce((n,p)=>n+p.unmet,0),unit:f.unit},{label:'净成交额',value:points.reduce((n,p)=>n+p.revenueCents,0),unit:'人民币分'}];const ids=new Set(points.flatMap(p=>p.evidenceIds));rows=rows.filter(r=>ids.has(r.id));}}
 if(parts[0]==='metric'){const ids=new Set(state.metrics[parts[1]].evidenceIds);rows=rows.filter(r=>ids.has(r.id));}
 const limit=Number(url.searchParams.get('limit')??20),cursor=Number(url.searchParams.get('cursor')??0);assert(Number.isInteger(limit)&&limit>0&&limit<=100&&Number.isSafeInteger(cursor)&&cursor>=0,422,'PAGINATION','分页参数无效');
 const sources=[...new Set(rows.map(r=>JSON.stringify([r.sourceId,r.kind])))].map(key=>{const [sourceId,kind]=JSON.parse(key);return {kind,batch_id:sourceId,filename:sourceId,source_name:sourceId,recordCount:rows.filter(r=>r.sourceId===sourceId&&r.kind===kind).length,downloadUrl:null};});
 return {evidence:{id,snapshotId:g.id,businessId:g.state.businessId,dataNature:g.state.dataNature,title,value:metrics,formula,sourceCount:rows.length,periodStart:period.start,periodEnd:period.end,asOf:g.state.asOf,limitations:g.state.quality.gaps},analysis:{version:'evidence-analysis-v1',judgment:{title:review?.headline??title,summary:review?.explanation??'展示已登记资料的计算对照；尚未形成已保存的 AI 判断。',nextStep:review?.nextAction.title??'先核对资料覆盖与未确认条件，再判断经营动作。'},metrics,observations,limitations:[...g.state.quality.gaps,...review?.limitations??[]]},sources,records:rows.slice(cursor,cursor+limit).map((r,i)=>({id:r.id,kind:r.kind,row_number:cursor+i+1,payload:JSON.stringify({...r,...(r.kind==='event'?{event_type:r.stage}:{}),business_date:r.businessDate,product_id:r.entityId,channel:r.channelId,quantity:r.quantity,amount_cents:r.amountCents,sellable_units:r.kind==='inventory'?Math.max(0,(r.quantity??0)-(r.reservedUnits??0)-(r.inspectionUnits??0)):null}),batch_id:r.sourceId,filename:r.sourceId})),nextCursor:cursor+limit<rows.length?cursor+limit:null,externalSources};
}
const stagesKeys=()=>['A1Customers','A2Customers','A3Customers','A4Customers'];

// Preserve explicit legacy snapshot URLs. Only canonical IDs, or unpinned
// businesses with a published generation, use this compatibility projection.
export async function handleWorkbenchCompat(request:Request,ctx:Context,segments:string[]):Promise<Response|null>{
 const [resource,id,action]=segments;if(!resources.has(resource))return null;
 const url=new URL(request.url),nature=url.searchParams.get('dataNature')??'business';assert(['business','demo'].includes(nature),422,'NATURE','资料性质无效');
 const input=request.method==='POST'?await agentBody(request.clone()):null;
 const explicit=url.searchParams.get('snapshotId')??url.searchParams.get('generationId')??(typeof input?.snapshotId==='string'?input.snapshotId:null);
 if(explicit&&!canonicalId(explicit))return null;
 if(!explicit&&resource!=='operating-snapshot')return null;
 const row=explicit?await first<{payload:string}>(ctx.db,'SELECT payload FROM neo_business_generations WHERE id=? AND business_id=? AND data_nature=?',explicit,ctx.businessId,nature):await currentBusinessGeneration(ctx,nature);
 if(!row){assert(!explicit,404,'GENERATION','经营资料不属于当前企业与数据性质');return null;}
 const g=await loadGeneration(ctx,nature,row.payload),s=generationSnapshot(g),policy=agentPolicy(ctx.runtime,ctx.businessId),canGenerate=ctx.role!=='reader'&&policy.interactiveAllowed;
 if(input){requireWrite(request,ctx);assert(input.dataNature==null||input.dataNature===nature,409,'SCOPE','请求资料性质不一致');assert(input.snapshotId==null||input.snapshotId===g.id,409,'SCOPE','请求资料版本不一致');}
 assert(request.method==='GET'||request.method==='POST',405,'METHOD','不支持此方法');
 if(input)assert(['agent-runs','home-decision','growth-reviews','market-workbench','forecasts','scenarios','decisions','policy-briefing'].includes(resource),405,'METHOD','此资源仅可读取');
 if(resource==='policy-briefing')return handlePolicyBriefing(request,ctx,{body:agentBody,snapshot:async(_ctx,id,nature)=>{assert(id===g.id&&nature===s.dataNature,409,'SCOPE','政策资料范围不一致');return s;}});
 if(resource==='operating-snapshot')return json({snapshot:s});
 if(resource==='agent-domain')return json(generationDomain(g));
 if(resource==='agent-policy')return json({...policy,automaticPatrolAllowed:false});
 if(resource==='evidence'&&id&&(id.startsWith('operating-plan-')||id.startsWith('operating-preview-'))){const {operatingPlanEvidence}=await import('./operating-plans.ts');return json(await operatingPlanEvidence(ctx,nature,id,g.id));}
 if(resource==='agent-runs'&&input&&!id&&input.operatingPlanId)return json(await queueOperatingBrain(ctx,g,input),202);
 if(resource==='agent-runs'&&!id&&request.method==='GET'&&url.searchParams.has('operatingPlanId'))return json(await readOperatingBrains(ctx,nature,g.id,url.searchParams.get('operatingPlanId')!));
 if(resource==='agent-runs'&&id){const raw=await readOperatingRun(ctx,nature,g.id,id.split('~')[0]);if(raw.operatingPlanId)return handleAgents(request,ctx,segments);}
 if(resource==='agent-runs'&&id){const [runId,role='joint']=id.split('~');assert(['joint','conversion','supply','market','orchestrator'].includes(role),404,'MODE','智能体类型不存在');if(action){await readOperatingRun(ctx,nature,g.id,runId);const path=['agent-runs',runId,action],response=await handleAgents(request,ctx,path);if(!response)return null;const raw=await response.json();return json(projectedRun(g,raw,role),response.status);}return json(projectedRun(g,await readOperatingRun(ctx,nature,g.id,runId),role));}
 if(resource==='agent-runs'&&input){const roles=['conversion','supply','market','joint','orchestrator'];assert(roles.includes(String(input.mode)),422,'MODE','智能体类型无效');assert(typeof input.question==='string'&&input.question.trim()&&input.question.length<=1000,422,'QUESTION','问题须为1至1000字');assert(typeof input.requestId==='string',422,'REQUEST_ID','需要稳定请求标识');const result=await operatingReviews(ctx,nature,g.id,true,String(input.requestId),{question:input.question,role:String(input.mode),sessionId:typeof input.sessionId==='string'?input.sessionId:undefined,dialogueScope:input.dialogueScope as import('./agent-conversation.ts').DialogueScope|undefined,scenarios:input.scenarios as unknown[]|undefined},input.budget);return json(projectedRun(g,result as AgentRun,String(input.mode)),202);}
 if(resource==='agent-runs'){const rows=await all<{id:string}>(ctx.db,"SELECT id FROM neo_runs WHERE business_id=? AND data_nature=? AND snapshot_id=? AND json_extract(payload,'$.purpose')='operating' ORDER BY created_at DESC LIMIT 12",ctx.businessId,nature,g.id);const runs=await Promise.all(rows.map(r=>readOperatingRun(ctx,nature,g.id,r.id)));return json({currentConfigurationId:(await activePlatformSettings(ctx,nature)).id,items:runs.flatMap(r=>['joint','conversion','supply','market','orchestrator'].map(role=>projectedRun(g,r,role))),policy});}
 let started:AgentRun|undefined;
 if(['home-decision','growth-reviews','market-workbench'].includes(resource)&&input){assert(canGenerate,403,'AGENT_EXECUTION_DISABLED',policy.notice??'当前权限不可更新判断');started=await operatingReviews(ctx,nature,g.id,true,typeof input.requestId==='string'?input.requestId:undefined,undefined,input.budget) as AgentRun;}
 const run=await latestRun(ctx,nature,g,started),home=projectedHome(g,run,canGenerate);
 if(resource==='home-decision')return json(home,input?202:200);
 if(resource==='growth-reviews')return json({sourceKey:g.sourceKey,completeReviews:run?.completeRun?Object.fromEntries(['conversion','supply','market'].map(role=>[role,projectedRun(g,run.completeRun,role)])):{},reviews:run?Object.fromEntries(['conversion','supply','market'].map(role=>[role,projectedRun(g,run,role)])):{},canGenerate,marketSearchAllowed:policy.marketSearchAllowed,notice:policy.notice},input?202:200);
 if(resource==='customer-journey')return json({journey:generationJourney(g),review:specialist(g,run,'conversion')});
 if(resource==='market-workbench')return json({...compatibilityMarket(g,run),canGenerate},input?202:200);
 const sections=compatibilitySections(g,run);
 if(resource==='home-sections')return json(sections);
 if(resource==='supply-overview')return json({...sections.goods,industry:g.state.profile.industry,unit:g.baseline.unit,positions:s.data.inventory,capacity:g.state.inputs.filter(r=>r.kind==='hotel_capacity'&&r.businessDate>s.asOf),constraints:g.baseline.feasibility});
 if(resource==='forecasts'){if(input)assert(input.snapshotId===g.id,409,'SCOPE','须选择当前资料版本');const f=projectedForecast(g);if(input){assert(f,422,'INSUFFICIENT',g.baseline.feasibility.reasons.join('；'));return json(f);}return json({items:f?[f]:[]});}
 if(resource==='scenarios'&&input){assert(input.baselineId===baselineId(g),409,'BASELINE','方案须使用同一冻结经营基线');let spec:ScenarioSpec;try{spec=legacyScenario(g,(input.assumptions??{}) as ScenarioInput);}catch(e){throw new ApiError(422,'SCENARIO',(e as Error).message);}spec.name=typeof input.title==='string'?input.title:spec.name;const b=await createScenarioBundle(ctx,nature,{generationId:g.id,requestId:input.requestId,scenarios:[spec]}) as Bundle;const result=projectedScenario(g,b.results[0],b.scenarios[0],b.id);assert(result,422,'INSUFFICIENT',b.results[0].feasibility.reasons.join('；'));return json(result,201);}
 if(resource==='decisions'&&input){assert(typeof input.scenarioId==='string'&&input.scenarioId.includes('~'),422,'SCENARIO','须选择已计算的方案');const [bundleId,scenarioId]=input.scenarioId.split('~');const available=await bundles(ctx,nature,g);assert(available.some(b=>b.id===bundleId&&b.scenarios.some(x=>x.id===scenarioId)),404,'SCENARIO','方案不属于当前经营资料');const d=await saveOperatingDecision(ctx,nature,{...input,bundleId,scenarioId});return json({id:d.id,snapshotId:g.id},201);}
 const bs=await bundles(ctx,nature,g),scenarios=bs.flatMap(b=>b.scenarios.map((spec,i)=>projectedScenario(g,b.results[i],spec,b.id)).filter(x=>x!==null));
 if(resource==='scenarios')return json({items:scenarios});
 if(resource==='decisions')return json({items:await compatibilityDecisions(ctx,nature,g)});
 if(resource==='decision-workbench'){const f=projectedForecast(g),d=decisionWorkbench(s,sections,home,f?[f]:[],scenarios,await compatibilityDecisions(ctx,nature,g),{...generationDomain(g),skus:generationDomain(g).skus.map(x=>({id:x.id,product_id:x.product_id!}))},url.searchParams.get('baselineId'));const head=await currentBusinessGeneration(ctx,nature);return json({...d,forecastQuality:g.salesForecast?salesForecastSummary(g.salesForecast):null,forecastBasisState:head?.id===g.id?'current':'historical',history:generationWeeks(g).map(w=>({start:w.start,end:w.end,units:g.salesForecast?.status==='ready'?g.state.inputs.filter(r=>r.kind==='order'&&r.entryType==='paid'&&r.businessDate>=w.start&&r.businessDate<=w.end).reduce((n,r)=>n+(r.quantity??0),0):w.state.metrics.fulfilledUnits.value})),operating:s.operating,templates:[{id:'A',title:'保持现状',summary:'延续已登记经营节奏'},{id:'B',title:g.state.profile.industry==='hotel'?'核查房晚能力':'核查并保供',summary:'比较现金、交期与供给约束'},{id:'C',title:'比较需求假设',summary:'需求改变为待验证假设'}],limitations:[...g.baseline.limitations,...g.baseline.feasibility.reasons]});}
 if(resource==='evidence'&&id){let result:ComputedScenario|undefined;if(id.includes(':forecast-week:')){const fId=decodeURIComponent(id.split(':forecast-week:')[1].split(':')[0]);if(fId!==baselineId(g)){const [bundleId,scenarioId]=fId.split('~'),b=bs.find(x=>x.id===bundleId);assert(b,404,'FORECAST','预测方案不属于当前资料');result=b.results.find(x=>x.id===scenarioId);assert(result,404,'FORECAST','预测方案不存在');}}return json(compatibilityEvidence(g,id,run,url,result));}
 return null;
}
