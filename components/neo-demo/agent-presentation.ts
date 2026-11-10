import type {AgentMode,AgentRun} from '../../server/agent-contracts';

// Presentation follows the 2026-09-29 handoff. Questions still go to real tools.
export const agentPresentation:Record<AgentMode,{name:string;speaker:string;action:string;placeholder:string;questions:string[]}>={
 conversion:{name:'转化纠察智能体',speaker:'转化纠察',action:'审查 4A 客户旅程变化',placeholder:'继续追问，或补充你的经营判断…',questions:['哪个旅程阶段变化最大','按渠道查看客户承接']},
 supply:{name:'供需纠察智能体',speaker:'供需纠察',action:'核查商品库存异常',placeholder:'询问库存、补货或调拨方案…',questions:['查看在途','比较调拨方案']},
 market:{name:'市场观察智能体',speaker:'市场观察',action:'筛选相关行业信息',placeholder:'追问市场变化，或补充竞品信息…',questions:['哪些行业变化与我有关','查看相关竞品原文']},
 joint:{name:'三智能体协作',speaker:'协同判断',action:'生成联动核查清单',placeholder:'向三位智能体追问，或@指定智能体…',questions:['先查哪一项','生成清单']},
 orchestrator:{name:'行动编排智能体',speaker:'行动编排',action:'生成行动草案',placeholder:'输入补货时间、预算或你的决策约束…',questions:['调整预算','比较方案']},
};

// Old saved reports remain readable; they are never rewritten into new facts.
export function conversationalText(text:string):string{
 if(text.length<=180)return text;
 const sentences=text.replace(/[#*`]/g,'').split(/(?<=[。！？])|\n/).map(x=>x.trim()).filter(Boolean);
 let brief='';
 for(const sentence of sentences){if(!/[。！？]$/.test(sentence))continue;if((brief+sentence).length>180)break;brief+=sentence;if(brief.length>=70)break;}
 return brief||'本次研判已保存，展开查看完整判断与依据。';
}

export function runNeedsRefresh(run:AgentRun|null|undefined):boolean{return !!run&&(['pending_dispatch','queued','running'].includes(run.status)||run.observability?.cancellationPending===true||run.observability?.resumePending===true);}
export function canResumeRun(run:AgentRun|null|undefined):boolean{
 if(!run||!['failed','cancelled'].includes(run.status)||run.observability?.cancellationPending)return false;
 const obs=run.observability;
 if(obs?.resumePending===true||obs?.gatewayControl)return false;
 if(!obs)return false;
 return obs.retryable===true||(run.status==='cancelled'&&!obs.errorCode&&!obs.modelCallsUncertain);
}
export function runBusinessStatus(run:AgentRun):string{
 if(run.observability?.cancellationPending)return '正在停止分析，保存已有结论';
 if(run.observability?.resumePending)return '正在核对继续分析的状态';
 if(['pending_dispatch','queued'].includes(run.status))return '等待分析';
 if(run.status==='running')return '正在分析';
 if(run.status==='completed')return '分析已完成';
 if(run.result?.finding||Object.keys(run.result?.specialists??{}).length)return '已停止，但保留已有结论';
 return canResumeRun(run)?'本次分析已停止，可以继续':'需要核查后再继续';
}
