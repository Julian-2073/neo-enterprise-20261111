import type {AgentRunEvidence} from '../../server/agent-contracts';
import {assessmentMetricName} from '../../lib/assessment-presentation';
import {evidenceMetricText as metricText} from '../../lib/evidence-metric-text';
import {supportLabel,runStatusLabel} from '../../lib/evidence-business-labels';
type Ref={id?:string;kind?:string;exact?:string;label?:string};
function metricValue(r:Ref){try{const v=JSON.parse(r.exact??'');if(r.kind==='metric'&&(typeof v.value==='number'||v.value===null)&&typeof v.unit==='string')return v as {value:number|null;unit:string};}catch{/* Non-metric legacy citations retain their raw evidence presentation. */}return null;}
const sourceName=(r:Ref)=>r.label??(r.kind==='metric'?assessmentMetricName((r.id??'').split(':').at(-1)!):r.kind==='paragraph'?'原文段落':r.kind==='query'?'原查询记录':r.kind==='enterprise_rule'?'企业确认资料':'已保存经营来源');
function sourceText(r:Ref){const metric=metricValue(r);if(metric)return metricText(metric);try{JSON.parse(r.exact??'');return '原保存依据已绑定，详情见下方。';}catch{return r.exact??'未记录精确依据';}}
export function RunEvidenceContent({data}:{data:AgentRunEvidence}){
 const a=data.run.result!.businessAssessment!,claims=(a.claims??[]).filter(c=>data.claimIds.includes(String(c.id)));
 return <><span className="neo-overline">已保存回答 · 陈述证据</span><h2 id="operating-evidence-title">本次回答的精确证据</h2>
 <p>{data.run.question}</p><p>统计期间：{data.period?`${data.period.start} 至 ${data.period.end}`:'原任务未记录期间'} · {runStatusLabel(data.run.status)}</p>
 {data.run.configurationFreshness?.status==='stale'&&<p role="status">当前发布配置已改变；这里保留原回答依据。</p>}{data.run.knowledgeFreshness?.status==='stale'&&<p role="status">来源版本已改变；原判断需复核。</p>}
 {!claims.length&&<p role="status">这条回答没有匹配的已保存陈述证据；暂不能用来源汇总替代其指标依据。</p>}
 {claims.map(c=><section key={String(c.id)} aria-label="回答陈述"><p>{String(c.statement)}</p><small>{supportLabel(c.status)}</small>
 <table className="neo-pulse-table"><thead><tr><th>指标或来源</th><th>原回答依据</th></tr></thead><tbody>{(c.supportingReferences as Ref[]??[]).map((r,i)=><tr key={r.id??i}><th>{sourceName(r)}</th><td>{sourceText(r)}</td></tr>)}</tbody></table>
 {(c.counterevidence as Ref[]??[]).length>0&&<><h3>需要同时考虑的反证</h3>{(c.counterevidence as Ref[]).map((r,i)=><p key={i}>{sourceText(r)}</p>)}</>}
 {(c.gaps as unknown[]??[]).length>0&&<><h3>仍需核验</h3>{(c.gaps as unknown[]).map((gap,i)=><p key={i}>{typeof gap==='string'?gap:'这条依据尚有未覆盖范围，见原记录详情。'}</p>)}</>}
 </section>)}
 <details className="neo-pulse-trace"><summary>原查询范围与来源关联</summary><p>以下编号关联原查询资料；精确指标由陈述绑定值证明，来源汇总不替代指标值。</p>
 <dl className="neo-definition neo-pulse-definition"><dt>统计范围</dt><dd>{JSON.stringify(a.scope.metricScope??{})}</dd><dt>企业 / 资料性质</dt><dd>{a.scope.businessId} / {a.scope.dataNature}</dd><dt>资料截至 / 研究截至</dt><dd>{a.scope.asOf} / {a.scope.researchAsOf}</dd><dt>原回答时间</dt><dd>{data.run.createdAt??'未记录'}</dd><dt>原任务状态</dt><dd>{data.run.status}</dd></dl>
 {claims.map(c=><section key={String(c.id)} aria-label="原陈述证据详情"><p>陈述：{String(c.id)} · 原支持状态：{String(c.status??'未记录')}</p>{[...(c.supportingReferences as Ref[]??[]),...(c.counterevidence as Ref[]??[])].map((r,i)=><details key={i}><summary>{sourceName(r)} · {r.id}</summary><pre>{r.exact??'未记录精确依据'}</pre></details>)}<pre>{JSON.stringify(c.gaps??[],null,2)}</pre></section>)}
 {data.sourceEvidenceIds.map(id=><p key={id}>{id}</p>)}{data.queryEvidence.map((q,i)=><pre key={i}>{JSON.stringify(q,null,2)}</pre>)}</details>
 <details className="neo-pulse-trace"><summary>原回答版本</summary><p>任务：{data.run.id}<br/>资料：{a.scope.inputId}<br/>计算版本：{a.scope.operatingVersion}<br/>配置版本：{a.scope.configurationVersion}</p><pre>{JSON.stringify(a.context.versions??[],null,2)}</pre></details></>;
}
