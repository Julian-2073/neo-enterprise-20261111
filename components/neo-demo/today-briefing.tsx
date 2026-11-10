"use client";

import {useHomeDecision,homeStatus} from "./home-decision";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {useNeoData,useAgentInsights} from "./operating-context";
import {displayNumber} from "../../lib/operating-demo-data";
import {BusinessText} from "./business-text";
import {investigationError} from "../../lib/business-presentation";
import { NeoIcon } from "./icons";

export function TodayBriefing({ onClose }: { onClose: () => void }) {
  const {demo,operating,money,percent,totalConversion,href}=useNeoData();
  const home=useHomeDecision();const decision=home.data?.decision;
  const {runs}=useAgentInsights();const sources=[...new Map(runs.flatMap(run=>run.result?.marketEvidence??[]).filter(source=>source.verificationStatus==='source_read').map(source=>[source.url,source])).values()].slice(0,3);
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
      const controls = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')];
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
    <section ref={dialogRef} className="neo-briefing-dialog" style={motion} role="dialog" aria-modal="true" aria-labelledby="today-brief-title" aria-describedby="today-brief-subtitle">
      <header className="neo-briefing-header">
        <div><span className="neo-overline">{demo.meta.business} · 老板工作台</span><h2 id="today-brief-title">今日经营简报</h2><p id="today-brief-subtitle">{operating?"当前快照的经营摘要与已保存研判；结论可继续追查依据。":"先看今日需要关注的经营判断，再决定从哪里追查。"}</p></div>
        <button ref={closeRef} type="button" className="neo-briefing-close" onClick={dismiss} aria-label="关闭今日经营简报"><NeoIcon name="close" size={20}/></button>
      </header>
      <div className="neo-briefing-body">
        <div className="neo-briefing-lead"><span>{operating?homeStatus(home.data,home.busy):"今日重点 · 演示判断"}</span><strong><BusinessText text={operating?decision?.judgment.title||(home.busy?"经营判断生成中":"经营判断尚未生成"):"意向增长，成交承接走弱"} review={!!operating}/></strong><p>{operating? decision?.judgment.summary||investigationError(operating.error) || demo.scopes.conversion.label:"主力品供给偏紧；先核查 R1 可售与客服承接，再决定是否增加投放。"}</p></div>
        {operating&&decision&&<div className="neo-briefing-lead"><span>建议先做</span><strong>{decision.action.title}</strong><p>{decision.action.summary}</p></div>}<div className="neo-daily-grid">
          <div className="neo-daily-side">
            <article className="neo-briefing-topic"><span className="neo-briefing-topic-icon"><NeoIcon name="evidence"/></span><h3>行业政策</h3><strong>{operating?"政策与市场原文":"等待可信政策来源"}</strong><p>{operating?"在渠道与竞品页查看已保存来源、抓取时间和核验状态；当前资料不能直接解释历史经营。":"暂无已核实的政策资料；向市场智能体提问后查看原始来源和时间。"}</p>{operating?<a href={href("/demo?page=market")}>查看已保存的市场来源 →</a>:<small>来源状态：尚未检索 · 暂不形成判断</small>}</article>
            <article className="neo-briefing-topic"><span className="neo-briefing-topic-icon"><NeoIcon name="chart"/></span><h3>我的企业</h3><strong>{operating?`支付订单 ${displayNumber(demo.conversion.stageTotals.A4)} 笔`:`A3 → A4 转化 ${percent(totalConversion)}`}</strong><p>{operating?`净成交额 ${money(demo.financial.netRevenue)}，投放费用 ${money(demo.financial.advertisingSpend)}，贡献毛利 ${money(demo.financial.contributionMargin)}。`:`R1 可售 42 件，净成交额 ${money(demo.financial.netRevenue)}。先核实库存与承接环节。`}</p><small>{operating?`来源：已提交导入记录 · 截至 ${demo.meta.asOf || "待导入"}`:"来源：演示经营数据 · 截至 09.24"}</small></article>
          </div>
          <article className="neo-daily-market"><div className="neo-daily-market-head"><span className="neo-briefing-topic-icon"><NeoIcon name="market"/></span><div><h3>市场观察与机会</h3><small>{operating?"当前观察 · 与历史经营分别解释":"模拟信息 · 截至 2026.09.24 · 待验证"}</small></div></div><div className="neo-daily-signals"><span>近期市场变化</span>{operating?(sources.length?sources.map(source=><div key={source.id}><b>{source.retrievedAt.slice(5,10).replace("-", ".")}</b><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></div>):<p>尚无已读取原文的市场来源。</p>):demo.market.events.map(event => <div key={event.id}><b>{event.date.slice(5).replace("-", ".")}</b>{event.title}</div>)}</div><div className="neo-daily-opportunities"><h4>值得关注的机会</h4>{demo.opportunities.map((item, i) => <div key={item.id}><span>{String(i + 1).padStart(2, "0")}</span><div><strong><BusinessText text={item.title} review={!!operating}/></strong><p><BusinessText text={item.reason} review={!!operating}/></p></div></div>)}</div><a href={href("/demo?page=market")} className="neo-daily-market-link">查看渠道与竞品 <NeoIcon name="arrow" size={16}/></a></article>
        </div>
      </div>
      <footer className="neo-briefing-footer"><span>{operating?`经营数据截至 ${demo.meta.asOf || "待导入"}；市场来源与诊断见已保存研判。`:"演示简报 · 经营数据截至 2026.09.24；没有实时政策或外部市场接入。"}</span><button type="button" className="neo-primary" onClick={dismiss}>进入今日经营<NeoIcon name="arrow" size={18}/></button></footer>
    </section>
  </div>;
}
