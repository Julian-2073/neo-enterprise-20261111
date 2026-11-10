import type {AgentRun,AgentFinding} from '../server/agent-contracts.ts';
export type ReplyScope={businessId:string;dataNature:string;inputId:string};
/** Claims are local to this reply, not every specialist in the assessment. */
export function replyClaims(run:AgentRun,finding:AgentFinding){
 const texts=[finding.conclusion,...(finding.basis??[]),...(finding.nextStep?[finding.nextStep]:[])];
 return (run.result?.businessAssessment?.claims??[]).filter(c=>typeof c.statement==='string'&&c.statement.trim()&&texts.some(text=>text.includes(String(c.statement).trim())));
}
export function replyQuality(run:AgentRun,finding:AgentFinding,scope:ReplyScope){
 const a=run.result?.businessAssessment;
 const inScope=run.snapshotId===scope.inputId&&(!a||(a.scope.businessId===scope.businessId&&a.scope.dataNature===scope.dataNature&&a.scope.inputId===scope.inputId));
 const partial=run.status!=='completed'||run.result?.partial===true;
 const stale=run.configurationFreshness?.status==='stale'||(!!run.knowledgeFreshness&&run.knowledgeFreshness.status!=='current');
 const claims=replyClaims(run,finding),assertions=claims.filter(c=>!c.statementType||c.statementType==='assertion');
 const unverified=assertions.some(c=>c.status!=='supported');
 const semantic=a?.context.semanticValidation as {status?:string}|undefined;
 const notices:string[]=[];
 if(!inScope)notices.push('这条回答不属于当前企业、资料性质或输入版本，请在对应资料中回读。');
 if(partial)notices.push('本轮尚未完整完成，以下仅保留已经取得的局部判断。');
 if(stale)notices.push('配置或知识依赖已改变，以下为原保存判断，行动条件需要重新核对。');
 if(unverified)notices.push('本回答包含尚未通过支持核验的陈述，请先查看证据与限制。');
 if(!a)notices.push('历史回答未保留统一的逐条证据校验，不能视为本轮已核实事实。');
 const basis=[...new Set(finding.basis??[])].filter(text=>text.trim()&&!finding.conclusion.includes(text.trim())).slice(0,2);
 const supportedBasis=basis.length>0&&basis.every(text=>{
  let remainder=text;
  for(const c of claims.filter(c=>c.status==='supported').sort((a,b)=>String(b.statement).length-String(a.statement).length))remainder=remainder.split(String(c.statement)).join('');
  return !remainder.replace(/[\s，,。.;；：:！？!?“”"'、（）()]/g,'');
 });
 const canPreview=inScope&&!partial&&!stale&&!unverified&&semantic?.status==='verified';
 const previewNotice=!inScope?'资料范围已改变，请回到对应版本。':partial?'本轮尚未完整完成，暂不将局部草案带入推演。':stale?'原判断的依赖已改变，请先重新核对。':!canPreview?'尚未取得完整支持核验，先核对证据与成立条件。':null;
 return {inScope,notices,basis,basisLabel:supportedBasis?'已核对依据':'原保存依据 · 需结合证据核对',canPreview,previewNotice};
}
export function replyFollowupDraft(kind:'evidence'|'conditions'){
 return kind==='evidence'?'请核对上一轮判断的关键依据，分开已知事实、待验证解释和资料缺口。':'请继续核对上一轮建议的成立条件与下一步验证方法，不执行经营动作。';
}
/** Summarize recorded milestones only; do not invent progress percentages or ETA. */
export function recordedAgentProgress(run:AgentRun){
 const phases=[[/理解.*(?:范围|意图|目标)|界定对象/,'核对问题范围'],[/读取.*(?:经营|固定版本)|补齐.*经营证据查询/,'读取经营资料'],[/核对回答|核验.*(?:结果|陈述)|修正未通过/,'核对回答与证据'],[/整理.*(?:结果|判断)|协同.*整理/,'整理分析结果']] as const;
 const events=run.steps.flatMap(step=>{const phase=phases.find(([pattern])=>pattern.test(step.message))?.[1];return phase?[{label:phase,at:step.at}]:[];});
 return events.filter((e,i)=>i===events.length-1||e.label!==events[i+1].label).slice(-3);
}
