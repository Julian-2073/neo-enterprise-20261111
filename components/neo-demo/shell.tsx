"use client";

import { useState } from "react";
import {useNeoData} from "./operating-context";
import {OperatingScope} from './operating-scope';

const pages = [
  { id: "home", label: "今日经营", href: "/demo" },
  { id: "people", label: "我的客户", href: "/demo?page=people" },
  { id: "goods", label: "供应链与库存", href: "/demo?page=goods" },
  { id: "market", label: "渠道与竞品", href: "/demo?page=market" },
  { id: "overview", label: "生意预测/协同", href: "/demo?page=overview" },
];

export function DemoShell({ active, children }: { active: string; children: React.ReactNode }) {
  const {demo,operating,href}=useNeoData();
  const [menuOpen, setMenuOpen] = useState(false);
  const scope = active === "people" || active === "overview" ? "R1 / 抖音店铺" : active === "goods" ? "全部商品 / 全渠道" : "全渠道";
  return <div className={`neo-demo neo-screen-${active}`}>
    <header className="neo-topbar">
      <a href={href("/demo")} className="neo-wordmark" aria-label="NEO 今日经营"><img src="/brand/neo-logo.png" alt="NEO" width="105" height="50" /></a>
      <span className="neo-client-mobile">{demo.meta.business}</span>
      <nav id="neo-main-nav" className={`neo-nav ${menuOpen ? "is-open" : ""}`} aria-label="主导航">{pages.map(page => <a key={page.id} href={href(page.href)} className={page.id === active ? "active" : ""} aria-current={page.id === active ? "page" : undefined} onClick={() => setMenuOpen(false)}>{page.label}</a>)}</nav>
      <a href={href("/demo?page=weekly")} className={`neo-weekly-link ${active === "weekly" ? "active" : ""}`} aria-current={active === "weekly" ? "page" : undefined}><span className="neo-weekly-label">{operating?"本周经营决策":"本周行动周报"}</span><span className="neo-weekly-short">周报</span></a>
      <button type="button" className="neo-mobile-menu" aria-controls="neo-main-nav" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>{menuOpen ? "收起" : "菜单"}</button>
      <div className="neo-top-context"><span className="neo-client-name">{demo.meta.business}</span><span>{operating ? `${demo.scopes.conversion.label} · 截至 ${demo.meta.asOf || "待导入"}` : `${scope} · 近 8 周 · 09.24`}</span></div>
      <span className="neo-mock-badge">{operating ? operating.nature === "demo" ? operating.snapshot ? "验收样例 · 已保存" : "验收样例 · 无快照" : "业务导入 · 待核实" : "模拟数据"}</span>
    </header>
    <main className="neo-main"><OperatingScope>{children}</OperatingScope></main>
    <footer className="neo-footnote">{operating ? '数据来自已保存的导入资料；来源完整性与实际经营效果仍需核实。' : "原型演示 · 不连接真实经营系统"}{operating?.snapshot&&<details><summary>查看资料版本</summary>{operating.snapshot.id}</details>}</footer>
  </div>;
}
