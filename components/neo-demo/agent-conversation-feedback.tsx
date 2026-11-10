'use client';
import './agent-conversation-feedback.css';
import type {AgentRun} from '../../server/agent-contracts';
import {recordedAgentProgress} from '../../lib/agent-reply-quality';
import {runBusinessStatus} from './agent-presentation';
export function AgentProgress({run}:{run:AgentRun}){
 const events=recordedAgentProgress(run),obs=run.observability??run.result?.runtime;
 return <section className="neo-agent-progress" aria-label="本轮分析进度" role="status"><strong>{runBusinessStatus(run)}</strong>
 {run.communicationError&&<p>暂未取得最新状态，以下为最后一次已知进度。</p>}
 <small>{obs?.queuePosition!=null?`等待顺序 ${obs.queuePosition} · `:''}{obs?.waitSeconds!=null?`已等待 ${obs.waitSeconds} 秒 · `:''}{obs?.runSeconds!=null?`已分析 ${obs.runSeconds} 秒`:'耗时尚未回报'}</small>
 {events.length>0?<ol>{events.map((event,i)=><li key={i}>{event.label}<small>{Number.isFinite(Date.parse(event.at))?new Date(event.at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'时间未记录'}</small></li>)}</ol>:<p>尚无新的阶段记录；不会据此估算完成时间。</p>}
 <small>仅显示已记录进展；分析完成后仍需核对证据与适用条件。</small></section>;
}
