import {monitoredPolicyBriefing,queuePolicySources} from './knowledge-briefing.ts';
import {requireWrite,type Context} from './auth.ts';
import {agentPolicy} from './agent-policy.ts';
import {assert,json} from './errors.ts';
import {first} from './store.ts';
import {hash} from './csv.ts';
import {patrolDay} from '../lib/agent-missions.ts';
import type {Snapshot} from './contracts.ts';

// A small, reviewed source register. Business reminders are enabled only after
// today's fetched original still contains the clauses on which they depend.
// This is not a claim to have searched every national or local policy.
export const POLICY_VERSION='official-policy-v1';
export const POLICY_SOURCES=[{
 id:'sports-consumption',url:'https://www.mct.gov.cn/preview/whhlyqyzcxxfw/wlrh/202509/t20250909_962109.html',
 title:'国务院办公厅关于释放体育消费潜力进一步推进体育产业高质量发展的意见',issuer:'国务院办公厅',
 documentNumber:'国办发〔2025〕31号',label:'体育消费支持：关注体验与场馆渠道',
 summary:'鼓励体育用品升级、体验式消费和场馆设备更新。',
 relevance:'健身器材可关注线下体验、场馆合作；先验证客户需求和供货能力。',
 applicability:'全国性行业指导。消费券和设备更新支持仍要核对当地细则及项目条件。',
 clauses:['推动体育用品升级','体验式体育消费新模式','支持将符合条件的体育场馆设备纳入大规模设备更新支持范围'],
},{
 id:'trade-in-2026',url:'https://www.ndrc.gov.cn/xxgk/zcfb/tz/202512/t20251230_1402851.html',
 title:'关于2026年实施大规模设备更新和消费品以旧换新政策的通知',issuer:'国家发展改革委、财政部',
 documentNumber:'发改环资〔2025〕1745号',label:'以旧换新：健身器材补贴需单独核对',
 summary:'全国统一的家电补贴范围列出6类家电，未列跑步机、划船机或哑铃。',
 relevance:'当前健身器材不能直接按家电“国补”促销；如有地方补贴，先核对品类和参与资格。',
 applicability:'2026年度全国政策；地方可自主确定部分补贴范围。企业所在地尚未确认。',
 clauses:['冰箱、洗衣机、电视、空调、电脑、热水器等6类家电','具体补贴品类、补贴标准由地方结合实际自主合理制定','截至2026年12月31日'],
}] as const;
type RegisteredSource=typeof POLICY_SOURCES[number];
export type PolicyItem={id:string;label:string;summary:string;relevance:string;applicability:string;source:{title:string;url:string;issuer:string;documentNumber:string;publishedAt:string|null;retrievedAt:string;contentHash:string;verificationStatus:'source_read'};evidence:string[]};
type StoredItem=PolicyItem&{originalText:string};
export type PolicyBriefing={id:string;businessId:string;snapshotId:string;dataNature:string;version:string;checkedAt:string;day:string;items:PolicyItem[];gaps:string[];coverage:string;stale:boolean;canRefresh:boolean};
type StoredBrief=Omit<PolicyBriefing,'stale'|'canRefresh'|'items'>&{items:StoredItem[]};
type Dependencies={snapshot:(ctx:Context,id:unknown,nature:unknown)=>Promise<Snapshot>;body:(r:Request)=>Promise<Record<string,unknown>>};
export function policyText(html:string){return html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n:string)=>String.fromCodePoint(Math.min(0x10ffff,n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10)))).replace(/&(?:nbsp|ensp|emsp);/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();}
export function policyPublishedAt(html:string):string|null{
 const tag=html.match(/<meta\b[^>]*name\s*=\s*["']PubDate["'][^>]*>/i)?.[0];
 const value=tag?.match(/content\s*=\s*["']([^"']+)/i)?.[1];
 const date=value?.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:\s|$)/);
 if(!date)return null;const day=`${date[1]}-${date[2]}-${date[3]}`;
 return Number.isFinite(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day?day:null;
}
export function fitnessPolicyRelevant(s:Snapshot){
 const products=s.data.materials?.domain.products??s.domain?.products??[];
 // Require imported product descriptions, not the business name or a fixture ID.
 return products.some(p=>/健身|跑步机|划船机|哑铃|力量训练|treadmill|rowing|dumbbell/i.test(JSON.stringify(p)));
}
export async function readRegisteredPolicy(source:RegisteredSource,now=new Date(),fetcher:typeof fetch=fetch):Promise<StoredItem>{
 const timeout=AbortSignal.timeout(18000);
 const response=await fetcher(source.url,{signal:timeout,redirect:'error',headers:{Accept:'text/html'}});
 assert(response.ok&&/text\/html/i.test(response.headers.get('content-type')??''),502,'POLICY_SOURCE_UNAVAILABLE','政策原文暂时无法读取');
 assert(!response.url||response.url===source.url,502,'POLICY_REDIRECT','政策原文地址发生改变，需要重新核验');
 const reader=response.body?.getReader();assert(reader,502,'POLICY_SOURCE_UNAVAILABLE','政策原文为空');
 const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;assert(bytes<=300000,502,'POLICY_SIZE','政策原文超出读取范围');chunks.push(value);}}finally{await reader.cancel();}
 const raw=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
 const html=new TextDecoder().decode(raw),text=policyText(html);
 const compact=(value:string)=>value.replace(/\s/g,'');
 assert(text.length>500&&compact(text).includes(compact(source.title))&&compact(text).includes(compact(source.documentNumber))&&source.clauses.every(c=>compact(text).includes(compact(c))),502,'POLICY_CHANGED','政策原文内容或条款已变，需要重新核验');
 const publishedAt=policyPublishedAt(html);
 assert(publishedAt&&publishedAt<=patrolDay(now),502,'POLICY_DATE','政策发布日期尚未核实');
 assert(source.id!=='trade-in-2026'||patrolDay(now)<='2026-12-31',502,'POLICY_EXPIRED','2026年度政策已到期，需要更新来源');
 return {id:source.id,label:source.label,summary:source.summary,relevance:source.relevance,applicability:source.applicability,source:{title:source.title,url:source.url,issuer:source.issuer,documentNumber:source.documentNumber,publishedAt,retrievedAt:now.toISOString(),contentHash:await hash(text),verificationStatus:'source_read'},evidence:[...source.clauses],originalText:text};
}
function publicBrief(value:StoredBrief,ctx:Context):PolicyBriefing{return {...value,items:value.items.map(item=>({id:item.id,label:item.label,summary:item.summary,relevance:item.relevance,applicability:item.applicability,source:item.source,evidence:item.evidence})),stale:value.day!==patrolDay(),canRefresh:ctx.role!=='reader'&&agentPolicy(ctx.runtime,ctx.businessId).marketSearchAllowed};}
export async function handlePolicyBriefing(request:Request,ctx:Context,deps:Dependencies){
 assert(['GET','POST'].includes(request.method),405,'METHOD','只支持读取或更新政策简报');
 const url=new URL(request.url),body=request.method==='POST'?await deps.body(request):null;
 if(body){requireWrite(request,ctx);assert(agentPolicy(ctx.runtime,ctx.businessId).marketSearchAllowed,403,'POLICY_RESEARCH_DISABLED','本企业尚未开启外部政策原文读取');assert(body.refresh===undefined||typeof body.refresh==='boolean',422,'REFRESH','更新标记须为布尔值');if(body.refresh)assert(typeof body.requestId==='string'&&/^[a-zA-Z0-9-]{1,40}$/.test(body.requestId),422,'REQUEST_ID','更新须有稳定请求标识');}
 const s=await deps.snapshot(ctx,body?body.snapshotId:url.searchParams.get('snapshotId'),body?body.dataNature:url.searchParams.get('dataNature'));
 const latest=await first<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE business_id=? AND data_nature=? AND snapshot_id=? AND kind='policy-briefing' AND json_extract(payload,'$.version')=? ORDER BY created_at DESC,rowid DESC LIMIT 1",ctx.businessId,s.dataNature,s.id,POLICY_VERSION);
 const current=await monitoredPolicyBriefing(ctx,s);
 if(!body)return json({briefing:current??(latest?{...publicBrief(JSON.parse(latest.payload),ctx),stale:true,verificationMethod:'legacy_registered_guidance',ageNotice:'历史静态简报，未经过本轮模型抽取与适用性判断。'}:null),canRefresh:ctx.role!=='reader'&&agentPolicy(ctx.runtime,ctx.businessId).marketSearchAllowed});
 const requestId=typeof body.requestId==='string'?body.requestId:'daily-'+(await hash(s.id)).slice(0,20)+'-'+patrolDay();
 assert(/^[a-zA-Z0-9-]{1,100}$/.test(requestId),422,'REQUEST_ID','政策刷新须提供稳定 requestId');
 const tasks=await queuePolicySources(ctx,s,requestId);
 return json({briefing:current,tasks,status:'queued',notice:'原文读取、模型抽取和支持校验进入持久队列；完成前不生成新政策判断。'},202);
}
