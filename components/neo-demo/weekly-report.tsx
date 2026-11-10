"use client";

import {DecisionReport} from "./live-agents";
import { useEffect, useState } from "react";
import {OperatingProvider,useNeoData} from "./operating-context";
import { NeoIcon } from "./icons";
import { DemoShell } from "./shell";

const storageKey = "neo-demo:20260929:draft";

export function WeeklyActionReport({mode="business"}:{mode?:"business"|"example"}){return mode==="example"?<WeeklyReportView/>:<OperatingProvider><DemoShell active="weekly"><DecisionReport/></DemoShell></OperatingProvider>;}
function WeeklyReportView() {
  const {demo,operating,href}=useNeoData();
  const connected=!!operating;
  const [status, setStatus] = useState("draft");
  useEffect(() => {
    if(connected)return;
    const read = () => {
      try {
        const stored = window.localStorage.getItem(storageKey);
        setStatus(stored && demo.actions.lifecycle.includes(stored) ? stored : "draft");
      } catch { setStatus("draft"); }
    };
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, [connected,demo.actions.lifecycle]);
  const draft = demo.actions.defaultDraft;
  const label = demo.actions.statusLabels[status as keyof typeof demo.actions.statusLabels] ?? "草案";
  const isStarted = status !== "draft";
  const isReviewed = status === "reviewed_demo";

  return <DemoShell active="weekly">
    <div className="neo-weekly-page">
      <div className="neo-weekly-heading"><div><span className="neo-overline">老板工作台 / 行动追踪</span><h1>本周行动周报</h1><p>从经营判断走到行动，查看已经确认的状态和下一步。</p></div><span className="neo-pill">{connected?"周报后端待接入":"本机演示记录"}</span></div>
      <div className="neo-weekly-grid">
        <section className="neo-card neo-weekly-main"><div className="neo-weekly-section-head"><span className="neo-weekly-icon"><NeoIcon name="lightning" size={22}/></span><div><span className="neo-overline">本周重点议题</span><h2>{connected?demo.issue.title:"意向增长，成交承接走弱"}</h2></div></div><p>{connected?"尚无经过确认的行动、经营诊断与复盘记录。":"主力品供给偏紧，建议先核查 R1 可售与客服承接，再决定是否增加投放。"}</p><div className="neo-weekly-facts"><span>转化 <b>{connected?"待接入":"12.5%"}</b></span><span>{connected?"供给规则":"R1 可售"} <b>{connected?"待接入":"42 件"}</b></span><span>数据截至 <b>{connected?demo.meta.asOf||"待导入":"09.24"}</b></span></div><a href={href("/demo?page=overview&view=evidence")} className="neo-inline-link">查看联动证据 <NeoIcon name="arrow" size={17}/></a></section>
        <section className="neo-card neo-weekly-status"><span className="neo-overline">行动进度</span><strong>{connected?"待接入":isReviewed ? "已完成演示复盘" : isStarted ? "1 项行动已进入流程" : "1 项行动待确认"}</strong><p>{connected?"周报及行动后端尚未接入。":isReviewed ? "复盘状态已记录；实际结果和指标变化尚未接入。" : isStarted ? `当前状态：${label}。下一步仍需负责人核对实际进展。` : "行动草案已生成，等待人工确认后再执行。"}</p><span className="neo-weekly-state">{label} · {connected?"尚无已保存行动":"仅保存在当前浏览器"}</span></section>
      </div>
      <section className="neo-card neo-weekly-action"><div className="neo-weekly-section-head"><span className="neo-weekly-icon"><NeoIcon name="evidence" size={22}/></span><div><span className="neo-overline">{connected?"本周行动清单 · 待接入":"本周行动清单 · 1 项"}</span><h2>{draft.title}</h2></div><span className="neo-weekly-state">{label}</span></div><div className="neo-weekly-action-details"><div><span>负责人</span><b>{draft.owner}</b></div><div><span>目标</span><b>{draft.goal}</b></div><div><span>计划日期</span><b>{draft.dueDate}</b></div></div><div className="neo-weekly-action-footer"><p>{connected?"行动执行、结果及周报后端待接入。":"演示行动状态来自本机记录；执行结果、真实责任人确认与本周新增数据尚未接入。"}</p><a href={href("/demo?page=overview&view=action")} className="neo-primary">查看行动与更新状态 <NeoIcon name="arrow" size={18}/></a></div></section>
      <p className="neo-weekly-disclaimer">{connected?"当前仅展示已保存经营快照的范围，不表示已生成经营周报。":"经营与市场数据为截至 2026.09.24 的演示快照。此页不是实时经营周报。"}</p>
    </div>
  </DemoShell>;
}
