'use client';
import type {AgentRun} from '../../server/agent-contracts';
import {assessmentClaims,assessmentMetricRows,assessmentMetricName} from '../../lib/assessment-presentation';
import {useAgentInsights,useOperating} from './operating-context';
import {BusinessText} from './business-text';
export function AssessmentDetails({run,evidenceId}:{run:AgentRun|null|undefined;evidenceId?:string}){
 const a=run?.result?.businessAssessment;if(!a)return run?<p role="status">历史结果 · 保存 {run.createdAt||'时间未记录'} · 未取得当前统一校验，原始记录仍可回读。</p>:null;
 const conversation=a.context.conversation as {versionChanged?:boolean;invalidatedDependencies?:string[];notice?:string}|undefined;
 const action=a.priorityAction,claims=assessmentClaims(a,evidenceId);
 return <section className="neo-live-summary" aria-label="统一经营判断"><small>保存 {run?.createdAt||'时间未记录'} · 经营截至 {a.scope.asOf} · 市场观察截至 {a.scope.researchAsOf} · {a.scope.dataNature==='demo'?'合成经营资料':'经营资料'}</small>
 {run?.configurationFreshness?.status==='stale'&&<p role="status">当前发布配置已改变，以下仅为原时间与配置下的历史判断。</p>}{run?.knowledgeFreshness&&run.knowledgeFreshness.status!=='current'&&<p role="status">知识依赖已过期或有冲突，以下为原保存判断，等待复核。</p>}{run?.status!=='completed'&&<p role="status">本次分析尚未完成；下面保留已取得的结果。</p>}{conversation?.versionChanged&&<p role="status">依赖已改变：{conversation.invalidatedDependencies?.join('、')}。本轮重新读取事实，旧结论需复核。</p>}
 <p><strong>重要变化：</strong><BusinessText text={a.projections.finding?.organization?.headline||a.projections.finding?.conclusion||'当前已校验判断'}/></p>
 <p><strong>业务影响：</strong><BusinessText text={a.projections.finding?.organization?.summary||a.projections.finding?.conclusion||'资料不足，暂不能确认影响'}/></p>
 <p><strong>优先核查：</strong>{action?<BusinessText text={String(action.title??action.action??'核对成立条件')}/>: '本轮是事实查询，尚未提出经营行动'}</p>
 <details><summary>关键数字、支持与反证</summary>{assessmentMetricRows(a).map(m=><p key={m.key}>{assessmentMetricName(m.key)}：{m.value==null?'待补数据':m.unit==='人民币分'?`¥${(m.value/100).toLocaleString('zh-CN')}`:m.value.toLocaleString('zh-CN')} {m.unit==='人民币分'?'元':m.unit} · {m.status}</p>)}
 {claims.map((c,i)=><article key={String(c.id??i)}><p><BusinessText text={String(c.statement??'')}/></p><small>支持状态：{String(c.status??'insufficient')}</small>{(c.supportingReferences as Array<{id:string;exact?:string}>??[]).map((r,j)=><details key={j}><summary>支持引用 {r.id}</summary><blockquote>{r.exact||'精确引用请回读原始记录'}</blockquote></details>)}{(c.counterevidence as Array<string|{id?:string;exact?:string}>??[]).map((r,j)=>typeof r==='string'?<details key={j}><summary>反证核查意见 · 未作为独立事实核验</summary><p>{r}</p></details>:<details key={j}><summary>反证引用 {r.id??'待确认'}</summary><blockquote>{r.exact||'尚无精确反证原文'}</blockquote></details>)}{(c.gaps as string[]??[]).length>0&&<details><summary>校验器限制说明 · 待核意见</summary><ul>{(c.gaps as string[]).map((g,j)=><li key={j}>{g}</li>)}</ul><small>这些说明尚未作为独立企业事实核验。</small></details>}</article>)}
 <h4>待确认条件</h4>{a.confirmations.map((c,i)=><p key={i}>{String(c.question??'')} · {String(c.impact??'')} · {String(c.method??'')}</p>)}{a.reviewConditions.map((g,i)=><p key={i}>{g}</p>)}
 <small>配置版本 {a.scope.configurationVersion} · 判断版本 {a.inputHash} · 计算版本 {a.scope.operatingVersion} · 保存选择不代表执行或实际收益。</small></details></section>;
}
export function CurrentAssessmentSummary(){const {assessmentRun}=useAgentInsights();const w=useOperating();return w?<AssessmentDetails run={assessmentRun}/>:null;}

export function HistoricalAssessment({run}:{run:AgentRun}){
 return <details className="neo-reply-details" aria-label="历史保存判断"><summary>历史保存判断 · {run.createdAt||'时间未记录'} · {run.status} · {run.knowledgeFreshness?.status||'未取得当前依赖校验'}</summary><p>以下为原保存结果，不能作为本页当前判断。</p>{run.result?.businessAssessment?<AssessmentDetails run={run}/>:<><p>原资料版本 {run.snapshotId}</p><p><BusinessText text={run.result?.finding?.conclusion||'未保存完整判断'}/></p></>}</details>;
}
