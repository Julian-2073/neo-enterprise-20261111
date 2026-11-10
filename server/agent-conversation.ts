import type {AgentResult} from './agent-contracts.ts';
import type {Context} from './auth.ts';
import {all,first} from './store.ts';
import {assert} from './errors.ts';
import {hash} from './csv.ts';
import {decodeInput} from './input-storage.ts';
import {readStoredResult} from './agent-state.ts';
export type DialogueScope={entityId?:string;skuId?:string;channelId?:string|null;period?:{start:string;end:string};topic?:string;scenarioIds?:string[]};
export function validateDialogueScope(value:unknown):DialogueScope{
 if(value===undefined)return {};assert(value&&typeof value==='object'&&!Array.isArray(value),422,'DIALOGUE_SCOPE','对话范围须为对象');
 const x=value as DialogueScope;assert(Object.keys(x).every(k=>['entityId','skuId','channelId','period','topic','scenarioIds'].includes(k)),422,'DIALOGUE_SCOPE','对话范围字段无效');
 for(const k of ['entityId','skuId','channelId','topic'] as const)assert(x[k]===undefined||k==='channelId'&&x[k]===null||typeof x[k]==='string'&&x[k]!.length>0&&x[k]!.length<=300,422,'DIALOGUE_SCOPE','对话筛选无效');
 assert(!x.period||/^\d{4}-\d{2}-\d{2}$/.test(x.period.start)&&/^\d{4}-\d{2}-\d{2}$/.test(x.period.end)&&x.period.start<=x.period.end,422,'DIALOGUE_SCOPE','对话期间无效');
 assert(!x.scenarioIds||Array.isArray(x.scenarioIds)&&x.scenarioIds.length<=10&&x.scenarioIds.every(v=>typeof v==='string'&&v.length>0&&v.length<=160),422,'DIALOGUE_SCOPE','方案标识无效');return x;
}
export async function assertSession(ctx:Context,id:string,nature:string,sourceKind:'snapshot'|'generation'){ // Input sources may change within an authorized session.
 void sourceKind;
 const row=await first<{actor_id:string;data_nature:string;snapshot_id:string|null;generation_id:string|null}>(ctx.db,'SELECT * FROM neo_sessions WHERE id=? AND business_id=?',id,ctx.businessId);
 assert(row&&row.actor_id===ctx.userId&&row.data_nature===nature,404,'SESSION_SCOPE','会话不属于当前身份、企业或资料性质');return row;
}
export async function previousDialogueEnvelope(ctx:Context,sessionId:string,nature:string){
 await assertSession(ctx,sessionId,nature,'generation');
 const row=await first<{payload:string}>(ctx.db,'SELECT payload FROM neo_runs WHERE session_id=? AND business_id=? AND data_nature=? ORDER BY created_at DESC,rowid DESC LIMIT 1',sessionId,ctx.businessId,nature);
 if(!row)return null;const job=JSON.parse(row.payload);
 return job.envelope?.envelopePacked?await decodeInput(JSON.stringify({storageFormat:'neo-inputs-gzip-v1',...job.envelope.envelopePacked})):job.envelope;
}
/** Bounded carried state, with immutable run references for every historical note.
 * Evicted material remains in the paginated session archive; it is never current evidence.
 */
type MemoryEntry={value:unknown;[key:string]:unknown};
type UserStatement={kind:string;statement:string;inputId:string;source:string;status:string;factUse:string};
type PriorConversation={memory?:Record<string,MemoryEntry[]>;userStatements?:UserStatement[]};
export function dialogueMemory(previous:PriorConversation|undefined,run:{id:string;snapshot_id:string;payload:string}|null,result:AgentResult|null){
 const old=previous?.memory??{},assessment=result?.businessAssessment;
 const action=assessment?.priorityAction as {title?:unknown;action?:unknown;status?:unknown;conditions?:unknown;scenarioComparison?:{scenarios?:Array<{id:string}>}}|null|undefined;
 const versions=(assessment?.context?.versions??[]) as Array<{kind:string}>;
 const add=(key:string,values:unknown[],limit=12)=>{
  const entries=[...(old[key]??[]),...values.filter(Boolean).map(value=>({runId:run?.id,inputId:run?.snapshot_id,value,validity:'historical_recheck_required'}))];
  return [...new Map(entries.map(v=>[JSON.stringify(v.value),v])).values()].slice(-limit);
 };
 return {version:'dialogue-memory-v1',status:'historical_context_only',topics:add('topics',run?[JSON.parse(run.payload).question]:[]),
  hypotheses:add('hypotheses',assessment?.hypotheses??[]),unfinishedInquiry:add('unfinishedInquiry',assessment?.confirmations??(result?.unfinishedAreas as unknown[]|undefined)??[]),
  actions:add('actions',action?[{title:action.title??action.action,status:action.status,conditions:action.conditions,scenarioIds:action.scenarioComparison?.scenarios?.map(s=>s.id),selectedIsExecuted:false}]:[]),
  ruleReferences:add('ruleReferences',versions.filter(r=>['enterprise_rule','knowledge','calculation'].includes(r.kind)),8),
  constraints:add('constraints',assessment?.reviewConditions??[]),archivePolicy:'Each category retains up to 12 distinct entries (rules 8); full older entries remain in immutable runs accessible through session history.'};
}
/** User reports remain traceable unverified statements; they never mutate immutable facts. */
export function dialogueUserStatements(previous:PriorConversation|undefined,question:string,inputId:string){
 const prior=previous?.userStatements??[];
 const kind=/更正|纠正|实际未|补充/.test(question)?'correction':/怀疑|假设|尚未查证/.test(question)?'hypothesis':/尚未.*核查|未完成.*核查|观察窗口.*未成熟/.test(question)?'unfinished_inquiry':null;
 const item=kind?{kind,statement:question.slice(0,1000),inputId,source:'user',status:'unverified_report',factUse:'not_current_evidence'}:null;
 return [...prior,...(item?[item]:[])].slice(-12);
}
/** Each run persists its own context; historical session rows and results are immutable. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Legacy and generation envelopes have different frozen schemas; field checks below preserve both formats.
export async function freezeConversation(ctx:Context,sessionId:string,nature:string,inputId:string,sourceKind:'snapshot'|'generation',envelope:Record<string,any>,scope:DialogueScope={},question=''){
 await assertSession(ctx,sessionId,nature,sourceKind);
 const rows=await all<{id:string;snapshot_id:string;payload:string;result:string|null;status:string}>(ctx.db,'SELECT id,snapshot_id,payload,result,status FROM neo_runs WHERE session_id=? AND business_id=? AND data_nature=? ORDER BY created_at DESC,rowid DESC LIMIT 17',sessionId,ctx.businessId,nature);
 const previous=rows[0]?JSON.parse(rows[0].payload):null;
 if(previous?.envelope?.envelopePacked)previous.envelope=await decodeInput(JSON.stringify({storageFormat:'neo-inputs-gzip-v1',...previous.envelope.envelopePacked}));
 const access={actorId:ctx.userId,role:ctx.role,policy:envelope.agentPolicy??null,ontology:envelope.ontology?.policy??null};
 const accessHash=await hash(JSON.stringify(access));
 assert(!previous?.envelope?.conversation?.accessHash||previous.envelope.conversation.accessHash===accessHash,404,'SESSION_SCOPE','会话访问范围改变，请另建会话');
 const basis=envelope.operatingBasis;
 const versions={knowledge:await hash(JSON.stringify({...envelope.knowledge,capturedAt:null})),input:inputId,metric:await hash(JSON.stringify(basis?.metrics??envelope.snapshot?.data??{})),calculation:basis?.operatingVersion??envelope.snapshot?.calculationVersion??'legacy',rules:await hash(JSON.stringify(basis?.configuration??envelope.platformConfiguration??{})),packs:await hash(JSON.stringify(envelope.industryPack??null)),documents:await hash(JSON.stringify(envelope.decisionContext?.marketEvidence??[])),claims:await hash(JSON.stringify(rows[0]?readStoredResult(rows[0].result).result?.businessAssessment?.context?.versions??[]:[])),records:basis?.savedRecords?.registryHash??null};
 const invalidatedDependencies=previous?Object.entries(versions).filter(([key,value])=>previous.envelope?.conversation?.versions?.[key]!==value).map(([key])=>key):[];
 const versionChanged=!!previous&&invalidatedDependencies.length>0;
 const previousSourceKind=previous?(previous.envelope?.operatingBasis?'generation':'snapshot'):null,sourceChanged=!!previousSourceKind&&previousSourceKind!==sourceKind;
 const unresolvedReferences:Array<{kind:string;value:unknown;reason:string}>=[];
 const active={...(previous?.envelope?.snapshot?.productId?{entityId:previous.envelope.snapshot.productId}:{}),...(previous?.envelope?.snapshot?.channel?{channelId:previous.envelope.snapshot.channel}:{}),...(previous?.envelope?.conversation?.active??{}),...scope};
 if(scope.scenarioIds&&/比较|对比/.test(question))active.scenarioIds=[...new Set([...(previous?.envelope?.conversation?.active?.scenarioIds??[]),...scope.scenarioIds])].slice(0,10);
 if(scope.entityId&&!scope.skuId)delete active.skuId;
 if(basis&&scope.skuId)assert(false,422,'DIALOGUE_SCOPE','此输入按实体统计，请指定已登记实体');
 const period=basis?.period??{start:envelope.snapshot?.periodStart,end:envelope.snapshot?.periodEnd};
 if(active.period&&(active.period.start<period.start||active.period.end>period.end)){assert(!scope.period,422,'DIALOGUE_SCOPE','本轮明确指定期间超出冻结输入');unresolvedReferences.push({kind:'period',value:active.period,reason:'原讨论期间超出新输入，须重新确认'});delete active.period;}
 if(sourceChanged){
  for(const key of ['entityId','channelId','scenarioIds'] as const){if(active[key]&&!scope[key]){unresolvedReferences.push({kind:key,value:active[key],reason:'输入来源改变，原商品/SKU/渠道/方案映射尚未核验，本轮不复用引用'});delete active[key];}}
 }
 if(basis?.queryData){
  for(const key of ['entityId','channelId'] as const)if(active[key]&&!basis.queryData.records.some((r:{entityId?:string;channelId?:string})=>r[key]===active[key])){
   assert(!scope[key],404,'DIALOGUE_SCOPE','本轮商品或渠道不属于冻结输入');unresolvedReferences.push({kind:key,value:active[key],reason:'引用在新冻结输入中未找到，本轮不复用'});delete active[key];
  }
  const available=new Set((basis.scenarioContext?.scenarios??[]).map((s:{id:string})=>s.id));
  if(active.scenarioIds){const absent=active.scenarioIds.filter((id:string)=>!available.has(id));if(absent.length){unresolvedReferences.push({kind:'scenarioIds',value:absent,reason:'原方案未取得当前代次计算，本轮不可比较'});active.scenarioIds=active.scenarioIds.filter((id:string)=>available.has(id));}}
 }
 if(!basis&&scope.skuId){assert((envelope.facts??[]).some((r:{fact?:Record<string,unknown>})=>r.fact?.sku_id===scope.skuId)||envelope.snapshot?.data?.inventory?.some((r:{sku_id?:string})=>r.sku_id===scope.skuId),404,'DIALOGUE_SCOPE','规格不属于当前冻结资料');}
 if(!basis&&scope.entityId){assert((envelope.facts??[]).some((r:{fact?:Record<string,unknown>})=>r.fact?.product_id===scope.entityId)||envelope.snapshot?.data?.inventory?.some((r:{product_id?:string})=>r.product_id===scope.entityId),404,'DIALOGUE_SCOPE','商品不属于当前冻结资料');}
 if(!basis&&scope.channelId){assert((envelope.facts??[]).some((r:{fact?:Record<string,unknown>})=>r.fact?.channel===scope.channelId)||(envelope.domain?.channels??[]).some((r:{id:string})=>r.id===scope.channelId),404,'DIALOGUE_SCOPE','渠道不属于当前冻结资料');}
 const last=rows.slice(0,4).reverse().map(r=>({runId:r.id,inputId:r.snapshot_id,status:r.status,question:JSON.parse(r.payload).question,validity:r.snapshot_id===inputId&&!versionChanged?'recheck_required':'superseded',finding:readStoredResult(r.result).result?.finding??null}));
 const summary=rows.slice(4,16).map(r=>({runId:r.id,inputId:r.snapshot_id,topic:JSON.parse(r.payload).question,status:r.status,evidenceStatus:'historical_not_current'}));
 const total=(await first<{n:number}>(ctx.db,'SELECT COUNT(*) n FROM neo_runs WHERE session_id=? AND business_id=? AND data_nature=?',sessionId,ctx.businessId,nature))?.n??0;
 const summaryTrace={totalHistoricalTurns:total,retainedSummaryTurns:summary.length,hasOlder:total>16,nextCursor:total>16?16:null,historyEndpoint:'agent-sessions/'+sessionId,lineageHash:await hash(JSON.stringify([previous?.envelope?.conversation?.summaryTrace?.lineageHash??null,previous?.id??null,summary.map(r=>r.runId)]))};
 const lastResult=rows[0]?readStoredResult(rows[0].result).result:null;
 const memory=dialogueMemory(previous?.envelope?.conversation,rows[0]??null,lastResult);
 const userStatements=dialogueUserStatements(previous?.envelope?.conversation,question,inputId);
 const temporaryHypotheses=[...memory.hypotheses,...userStatements.filter(x=>x.kind==='hypothesis')],unfinishedInquiry=[...memory.unfinishedInquiry,...userStatements.filter(x=>x.kind==='unfinished_inquiry'||x.kind==='correction')];
 if(!active.topic){active.topic=/退款|退货/.test(question)?'refund':/到货|收货/.test(question)?'arrival':/库存/.test(question)?'inventory':question.slice(0,100);}
 return {version:'scoped-dialogue-v1',sessionId,accessHash,versions,invalidatedDependencies,versionChanged,sourceChanged,previousSourceKind,currentSourceKind:sourceKind,unresolvedReferences,previousInputId:previous?.snapshotId??null,currentInputId:inputId,userStatements,notice:versionChanged?'输入版本已更新；本轮重新读取事实，历史数字和总结不能作为当前证据。':'每轮重新读取冻结事实；历史回答仅用于追踪讨论。',active:{...active,temporaryHypotheses,unfinishedInquiry},memory,recentTurns:last,summary,summaryTrace,history:last.flatMap(r=>[{role:'user',content:r.question},{role:'assistant',content:JSON.stringify({runId:r.runId,inputId:r.inputId,validity:r.validity,notice:'历史回答不构成本轮证据；数值须重新查询',gaps:r.finding?.gaps??[]})}])};
}
