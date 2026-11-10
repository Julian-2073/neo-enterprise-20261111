"use client";

import {useHomeDecision,homeStatus} from "./home-decision";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {useNeoData,useAgentInsights} from "./operating-context";
import {displayNumber} from "../../lib/operating-demo-data";
import {BusinessText} from "./business-text";
import {investigationError} from "../../lib/business-presentation";
import { NeoIcon } from "./icons";
import {PolicyBriefingPanel} from "./policy-briefing";
import "./live-today-briefing.css";

export function LiveTodayBriefing({ onClose }: { onClose: () => void }) {
  const {demo,operating,money,href}=useNeoData();
  const home=useHomeDecision();const decision=home.data?.decision;
  const {runs}=useAgentInsights();
  const marketRun=runs.find(run=>run.mode==='market'&&run.purpose==='review'&&run.status==='completed');
  const marketReview=marketRun?.result?.finding?.businessReview;
  const selectedIds=(marketRun?.result?.operatingReviews as {market?:{selectedSourceIds?:string[]}}|undefined)?.market?.selectedSourceIds;
  const evidenceIds=new Set(selectedIds??marketReview?.evidenceIds??[]);
  const sources=(marketRun?.result?.marketEvidence??[]).filter(source=>source.verificationStatus==='source_read'&&(evidenceIds.has(source.id)||!!marketRun&&source.id.startsWith(marketRun.id+':')&&evidenceIds.has(source.id.slice(marketRun.id.length+1))));
  const snapshot=operating?.snapshot;
  const scopedHref=(path:string)=>{if(!snapshot)return href(path);const url=new URL(path,'http://neo.local');url.searchParams.set('businessId',snapshot.businessId);url.searchParams.set('dataNature',snapshot.dataNature);url.searchParams.set('snapshotId',snapshot.id);return `${url.pathname}${url.search}`;};
  const judgment=operating?decision?.judgment.title||(home.busy?'经营判断生成中':'经营判断尚未生成'):'意向增长，成交承接走弱';
  const judgmentSummary=operating?decision?.judgment.summary||investigationError(operating.error)||demo.scopes.conversion.label:'主力品供给偏紧；先核查 R1 可售与客服承接，再决定是否增加投放。';
  const action=decision?.action;
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [motion, setMotion] = useState<CSSProperties>({});

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current?.click(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], summary')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", onKey);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  function dismiss() {
    if (closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onClose(); return; }
    const source = dialogRef.current?.getBoundingClientRect();
    const destination = document.querySelector(".neo-decision-hero")?.getBoundingClientRect();
    if (source && destination) {
      setMotion({
        "--brief-x": `${destination.left + destination.width / 2 - source.left - source.width / 2}px`,
        "--brief-y": `${destination.top + destination.height / 2 - source.top - source.height / 2}px`,
        "--brief-scale-x": String(Math.min(1, destination.width / source.width)),
        "--brief-scale-y": String(Math.min(1, destination.height / source.height)),
      } as CSSProperties);
    }
    setClosing(true);
    timerRef.current = window.setTimeout(onClose, 360);
  }

  return <div className={`neo-briefing-backdrop ${closing ? "is-closing" : ""}`}>
    <section ref={dialogRef} className={`neo-briefing-dialog ${operating?"is-live":""}`} style={motion} role="dialog" aria-modal="true" aria-labelledby="today-brief-title" aria-describedby="today-brief-subtitle">
      <header className="neo-briefing-header">
        <div><span className="neo-overline">{demo.meta.business} · 老板工作台</span><h2 id="today-brief-title">今日经营简报</h2><p id="today-brief-subtitle">{operating?`经营资料截至 ${demo.meta.asOf||"待导入"} · 先看重点，再查依据`:"先看今日需要关注的经营判断，再决定从哪里追查。"}</p></div>
        <button ref={closeRef} type="button" className="neo-briefing-close" onClick={dismiss} aria-label="关闭今日经营简报"><NeoIcon name="close" size={20}/></button>
      </header>
      <div className="neo-briefing-body">
        {operating?<><div className="neo-brief-priorities">
          <article className="neo-brief-judgment"><span className="neo-brief-label">今日重点 <small>{operating?homeStatus(home.data,home.busy):"演示判断"}</small></span><h3><BusinessText text={judgment} review={!!operating}/></h3><details><summary>为什么这样判断</summary><p><BusinessText text={judgmentSummary} review={!!operating}/></p></details></article>
          <article className="neo-brief-action"><span className="neo-brief-label">建议先做</span><h3><BusinessText text={operating?action?.title||"等待经营研判":"48 小时供给核查"} review={!!operating}/></h3><details><summary>查看建议依据</summary><p><BusinessText text={operating?action?.summary||"经营审查完成后，给出优先建议。":"核实 R1 可售与在途时间，复查客服承接，再决定是否增加投放。"} review={!!operating}/></p></details><a key={snapshot?.id} href={scopedHref("/demo?page=overview&view=action")}>进入行动决策 →</a></article>
        </div>
        <div className="neo-brief-metrics" aria-label="已保存经营数字">
          {[['净成交额',money(demo.financial.netRevenue)],['贡献毛利',money(demo.financial.contributionMargin)],[snapshot?.operating?'经营投入':'投放费用',money(demo.financial.advertisingSpend)],['支付订单',`${displayNumber(snapshot?.data.financial.paidOrders??demo.conversion.stageTotals.A4)} 笔`]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        <PolicyBriefingPanel/>
        <article className="neo-brief-market">
          <div className="neo-brief-section-head"><h3><NeoIcon name="market" size={19}/>市场观察</h3><a key={snapshot?.id} href={scopedHref(marketRun?`/demo?page=market&reviewRunId=${marketRun.id}`:"/demo?page=market")}>查看专业审查 →</a></div>
          <h4><BusinessText text={operating?marketReview?.title||"市场审查资料待补充":"竞品与渠道变化同期出现，待核查"} review={!!operating}/></h4>
          <details><summary>查看观察与原文依据</summary><p><BusinessText text={operating?marketReview?.summary||"尚无已完成的市场专业审查。":"演示信息仅供页面体验；未核实实际市场变化。"} review={!!operating}/></p>{sources.map(source=><a className="neo-brief-source" key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>)}</details>
        </article></>:null}
      </div>
      <footer className="neo-briefing-footer"><span>{operating?`经营数据截至 ${demo.meta.asOf || "待导入"} · ${operating.nature==="demo"?"模拟经营资料":"已导入经营资料"}；政策范围与来源可展开查看。`:"演示简报 · 经营数据截至 2026.09.24；没有实时政策或外部市场接入。"}</span><button type="button" className="neo-primary" onClick={dismiss}>进入今日经营<NeoIcon name="arrow" size={18}/></button></footer>
    </section>
  </div>;
}
