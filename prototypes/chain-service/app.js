(function () {
  "use strict";
  const M = window.NeoModel;
  const KEY = "neo-chain-service-prototype-v1";
  const routes = ["hq-home", "hq-issue", "store-home", "store-task", "customers"];
  let storageWarning = false;
  let state = M.seed();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && saved.version === M.VERSION && Array.isArray(saved.events) && saved.checks && Array.isArray(saved.bookings) && Array.isArray(saved.contacted)) state = { ...M.seed(), ...saved };
  } catch { storageWarning = true; }
  let route = routes.includes(location.hash.slice(1)) ? location.hash.slice(1) : "hq-home";
  let issueTab = "evidence", customerFilter = "all", query = "";
  let selected = new Set(M.customers.filter(c => c.eligible).map(c => c.id));
  let modal = null, lastFocus = null, toastTimer;
  const $ = s => document.querySelector(s);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const icon = (name, cls = "") => `<span class="${cls}" aria-hidden="true">${window.NeoIcons[name] || window.NeoIcons.Circle}</span>`;
  const btn = (text, action, style = "", ico = "", attrs = "") => `<button type="button" class="btn ${style}" data-action="${action}" ${attrs}>${ico ? icon(ico) : ""}${text}</button>`;
  const nav = (text, dest, style = "", ico = "ArrowRight") => btn(text, "navigate", style, ico, `data-route="${dest}"`);
  const badge = (text, style = "") => `<span class="badge ${style}">${text}</span>`;
  const notice = (text, style = "") => `<div class="notice ${style}">${icon(style === "amber" ? "WarningCircle" : "Info")}<p>${text}</p></div>`;
  const isStore = () => route.startsWith("store") || route === "customers";
  const fmt = x => Number(x).toLocaleString("zh-CN");
  function toast(text, error = false) {
    clearTimeout(toastTimer); $("#toast").textContent = text;
    $("#toast").className = `visible ${error ? "error" : ""}`;
    toastTimer = setTimeout(() => { $("#toast").className = ""; }, 3600);
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch { storageWarning = true; }
  }
  function commit(action, payload, message) {
    try {
      state = M.transition(state, action, payload);
      save(); closeModal(false); render();
      if (message) toast(message);
      return true;
    } catch (e) { toast(e.message, true); return false; }
  }
  function go(dest, tab) {
    if (!routes.includes(dest)) return;
    if (tab) issueTab = tab;
    closeModal(false); route = dest;
    if (location.hash !== `#${dest}`) location.hash = dest;
    else render();
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function phase() {
    if (state.reviewed) return "已复盘";
    if (state.outcomeReady) return "待确认复盘";
    if (state.executionAccepted) return "观察中";
    if (state.executionSubmitted) return "待验收";
    if (state.accepted) return "门店执行中";
    if (state.published) return "待门店接收";
    if (state.checked) return "待确认方案";
    if (state.checkRequested) return "门店核查中";
    return "待核查";
  }
  function nextStep() {
    if (!state.checkRequested) return { title: "先核实湖滨店的接待条件", text: "由总部发起人员、护理间和耗材核查。", dest: "hq-issue", tab: "evidence" };
    if (!state.checked) return { title: "门店需要补充现场情况", text: "切换到湖滨店，完成三项现场核查。", dest: "store-task" };
    if (!state.published) return { title: state.supportArranged ? "确认方案并下发任务" : "总部先解决耗材缺口", text: "补充 2 份耗材，预览门店收到的精准跟进任务。", dest: "hq-issue", tab: "plan" };
    if (!state.accepted || !state.supportReceived || !state.trained) return { title: "接收任务，完成现场准备", text: "确认耗材到位，并阅读联系与服务规则。", dest: "store-task" };
    if (!state.responses || state.bookings.length < 2) return { title: "跟进顾客并确认合适时段", text: "3 位适合跟进，2 个已核实的可预约时段。", dest: "customers" };
    if (!state.executionSubmitted) return { title: "向总部提交执行记录", text: "预约记录已齐全，实际到店结果仍需观察。", dest: "store-task" };
    if (!state.executionAccepted) return { title: "总部验收执行记录", text: "检查名单、准备、联系和预约，确认进入观察期。", dest: "hq-issue", tab: "execution" };
    if (!state.outcomeReady) return { title: "进入模拟观察日", text: "载入 10月21日的到店、服务与商品结果。", dest: "hq-issue", tab: "review" };
    if (!state.reviewed) return { title: "形成复盘与下一步决定", text: "区分执行完成、观察结果与尚未证实的增量。", dest: "hq-issue", tab: "review" };
    return { title: "协作已完成，查看本轮复盘", text: "本轮决定与依据已保存，可随时重置再次体验。", dest: "hq-issue", tab: "review" };
  }
  function progress() {
    const current = M.derived(state).stage;
    const steps = ["发现问题", "门店核查", "总部安排", "门店执行", "结果观察", "经营复盘"];
    return `<div class="stage-track" aria-label="协作进程">${steps.map((s, i) => `<button type="button" data-action="stage" data-index="${i}" class="${i < current ? "done" : i === current ? "current" : ""}" ${i === current ? 'aria-current="step"' : ""}><b>${i < current ? icon("Check") : i + 1}</b><span>${s}</span></button>`).join("")}</div>`;
  }
  function sidebar() {
    const store = isStore();
    const items = store
      ? [["store-home", "今日", "SquaresFour"], ["store-task", "行动", "ListChecks"], ["customers", "顾客", "Users"]]
      : [["hq-home", "今日经营", "SquaresFour"], ["hq-issue", "经营事项", "Target"]];
    return `<aside class="sidebar"><div class="brand-scope"><span class="eyebrow">${store ? "STORE WORKSPACE" : "HEADQUARTERS"}</span><strong>${store ? "湖滨店" : "澄禾护理 · 总部"}</strong><p>${store ? "店长李安 · 本店经营与执行" : "王宁 · 直营运营负责人"}</p></div><nav aria-label="${store ? "门店" : "总部"}页面">${items.map(([id, label, ico]) => `<button type="button" class="nav-item ${route === id ? "active" : ""}" data-action="navigate" data-route="${id}" ${route === id ? 'aria-current="page"' : ""}>${icon(ico)}${label}${route === id ? '<span class="nav-dot"></span>' : ""}</button>`).join("")}${store ? `<button type="button" class="nav-item" data-action="learning">${icon("BookOpen")}学习与服务</button>` : ""}</nav>
      ${store ? `<div class="kept-modules"><div class="eyebrow">正在协作</div><span>下午时段精准跟进</span><span>${phase()}</span></div>` : `<details class="kept-modules"><summary>原有 NEO 功能 · 保留</summary><span>我的客户</span><span>供应链与库存</span><span>渠道与竞品</span><span>生意预测 / 协同</span><span>本周经营决策</span><span>数据与智能中台</span><p class="scenario-note">本版独立演示五个新增核心页面，不替换原版功能。</p></details>`}
      <div class="sidebar-bottom">${icon("ShieldCheck")} 本地模拟空间<p class="scenario-note">澄禾护理为虚构品牌。<br>不连接 CRM，不发送消息，<br>不调用真实 AI 模型。</p>${btn("查看演示指南", "guide", "text gap-sm", "BookOpen")}</div></aside>`;
  }
  function shell(content) {
    const store = isStore();
    const mobileItems = store ? [["store-home", "今日", "SquaresFour"], ["store-task", "行动", "ListChecks"], ["customers", "顾客", "Users"]] : [["hq-home", "今日经营", "SquaresFour"], ["hq-issue", "经营事项", "Target"]];
    return `<div class="${store ? "store-mode" : ""}"><div class="demo-strip">${icon("Info")} 本地交互原型 · 全部为模拟数据 · Agent 使用预设场景演示</div><header class="topbar"><a class="wordmark" href="#hq-home" aria-label="NEO 总部首页"><i></i>NEO</a><div class="brand-caption"><strong>澄禾护理</strong><span>直营门店经营协作</span></div><div class="role-switch" aria-label="切换工作角色"><button type="button" class="${!store ? "active" : ""}" data-action="navigate" data-route="hq-home">${icon("Buildings")}总部工作台</button><button type="button" class="${store ? "active" : ""}" data-action="navigate" data-route="store-home">${icon("Storefront")}门店工作台</button></div><div class="top-tools">${btn("演示指南", "guide", "ghost small", "BookOpen")}${btn("<span>重置</span>", "reset", "ghost small reset-btn", "ArrowCounterClockwise", 'aria-label="重置演示"')}<span class="avatar ${store ? "teal" : ""}" title="${store ? "李安 · 店长" : "王宁 · 总部运营"}">${store ? "李" : "王"}</span></div></header>
      <div class="workspace">${sidebar()}<main class="main">${progress()}${storageWarning ? notice("浏览器未允许保存进度；当前页面仍可完整演示，刷新可能重置。", "amber") : ""}${content}<footer class="footer-note"><span>NEO 连锁经营协作 · 交互原型 v1 · 场景资料：SYNTHETIC_DEMO</span><span>${state.events.length} 条协作记录 · 进度保存在本浏览器</span></footer></main></div><nav class="mobile-nav" aria-label="移动端页面">${mobileItems.map(([id, label, ico]) => `<button type="button" class="${route === id ? "active" : ""}" data-action="navigate" data-route="${id}">${icon(ico)}${label}</button>`).join("")}<button type="button" data-action="guide">${icon("BookOpen")}指南</button></nav></div>`;
  }
  function heading(kicker, title, description, right = "") {
    return `<div class="page-heading"><div><div class="eyebrow">${kicker}</div><h1 tabindex="-1">${title}</h1><p>${description}</p></div>${right}</div>`;
  }
  function metric(label, value, unit, foot, tone = "", spark = false) {
    return `<div class="metric"><div class="label">${label}</div><div class="value">${value}${unit ? `<em>${unit}</em>` : ""}</div><div class="foot ${tone}">${foot}</div>${spark ? `<svg class="metric-spark" viewBox="0 0 60 28" aria-hidden="true"><path d="M1 23 L10 18 L19 20 L28 12 L37 14 L48 7 L59 4" fill="none" stroke="#6a96e7" stroke-width="2" stroke-linecap="round"/></svg>` : ""}</div>`;
  }
  function agentCard(store = false) {
    const n = nextStep();
    let title, text;
    if (state.reviewed) { title = "把经验留下，也保留证据边界。"; text = "本轮 2 位顾客完成服务，产生 89 元商品关联销售。记录证明本次协作与执行已完成，不能证明这一策略带来长期增量。"; }
    else if (state.outcomeReady) { title = "结果已回到同一条经营事项。"; text = "两位顾客均按预约到店。建议先继续小范围观察，比较相似时段，并记录取消、改约与新增需求。"; }
    else if (state.executionAccepted) { title = "预约已确认，服务结果还在观察。"; text = "执行验收已通过。接下来观察实际到店、服务完成与商品购买，分别保留记录。"; }
    else if (state.executionSubmitted) { title = store ? "执行记录已提交，等待总部验收。" : "执行凭据齐全，请核对后验收。"; text = "3 位已联系，2 位确认预约，1 位暂不预约。总部核对资源、规则与预约记录后，进入实际服务观察。"; }
    else if (state.bookings.length === 2) { title = "两条预约已确认，下一步提交记录。"; text = "14:00、15:00 均已安排。门店核对记录并提交总部；顾客是否实际到店，仍需在观察日确认。"; }
    else if (state.responses) { title = "已收到顾客回应，确认具体时段。"; text = "林女士与陈女士愿意预约，何女士本次暂不预约。按顾客偏好核对人员与房间，每个时段最多安排一位。"; }
    else if (state.contacted.length) { title = "本轮联系已记录，等待顾客回应。"; text = "继续跟进尚未联系的适合顾客，不重复联系已记录的名单。取得明确意愿之后，再安排预约。"; }
    else if (store && !state.checked) { title = "先确认现场能接，再安排顾客。"; text = "小林具备对应技能，A 护理间有空档。请店长核实实际排班、房间与耗材，不把排班空白直接当作可接待。"; }
    else if (!state.supportReceived && state.checked) { title = store ? "耗材到位后，再开始联系。" : "门店需要总部解决一项具体阻碍。"; text = "门店已确认人员与护理间可用，但还缺 2 份耗材。总部安排和门店收到分别记录，避免任务下达后仍无法执行。"; }
    else if (state.published) { title = "3 位适合跟进，先看理由再联系。"; text = "名单已排除已有预约、近期已联系和不接收营销联系的顾客。两条可预约时段均为 60 分钟，价格和权益保持原方案。"; }
    else { title = "先核查时段供需，再决定是否引流。"; text = "湖滨店下午占用率 42%，晚间 90%。现有资料提示时段分布不均；是否存在真正可用的接待能力，还需要门店确认。"; }
    return `<section class="agent-card"><div class="agent-head"><span class="agent-symbol">${icon("Sparkle")}</span><div><strong>${store ? "湖滨店 Agent" : "总部 Agent"}</strong><small>持续跟进当前经营事项</small></div>${badge("场景演示", "")}</div><div class="agent-body"><h3>${title}</h3><p>${text}</p><div class="agent-source">依据：模拟预约记录、排班资料与${state.checked ? "已确认的门店反馈" : "待核查的现场条件"}</div><div class="agent-chips"><button type="button" data-action="ask" data-question="why">为什么值得关注？</button><button type="button" data-action="ask" data-question="next">下一步做什么？</button><button type="button" data-action="ask" data-question="boundary">能证明有效吗？</button></div><form class="agent-input" id="agent-form"><input aria-label="询问场景 Agent" placeholder="问问当前事项，例如：耗材怎么处理" maxlength="200"><button type="submit" class="btn soft icon" aria-label="发送场景问题">${icon("ArrowRight")}</button></form><div id="agent-answer" hidden></div><div class="gap">${btn(n.dest.startsWith("hq") === !store ? "继续处理这件事" : store ? "前往总部处理" : "前往门店处理", "next", "soft block", "ArrowRight")}</div><p style="font-size:10px">预设场景问答，不调用真实模型。</p></div></section>`;
  }
  function logCard(limit = 4) {
    return `<section class="card compact"><div class="card-head"><h2>两端协作记录</h2>${btn("全部", "all-log", "text small", "ArrowUpRight")}</div><div class="log">${state.events.slice(-limit).reverse().map(e => `<div class="log-item"><small>${e.time} · ${esc(e.actor)}</small><strong>${esc(e.title)}</strong><p>${esc(e.detail)}</p></div>`).join("")}</div></section>`;
  }
  function handoff(dest, title, description, label, tab = "") {
    return `<div class="handoff">${icon(dest.startsWith("hq") ? "Buildings" : "Storefront", "iconbox")}<div style="flex:1"><strong>${title}</strong><p>${description}</p></div>${btn(label, "navigate", "small", "ArrowRight", `data-route="${dest}" data-tab="${tab}"`)}</div>`;
  }
  function heatmap() {
    const rows = [["湖滨店", 62, 48, 42, 58, 90], ["城西店", 56, 64, 67, 70, 82], ["滨江店", 71, 58, 61, 76, 88]];
    return `<section class="card"><div class="card-head"><div><h2>预约分布 · 找到需要核查的时段</h2><p>10.12—10.18 · 已预约服务时长 / 可预约服务时长</p></div>${badge("历史模拟资料")}</div><div class="heatmap"><span></span>${["10—12", "12—14", "14—16", "16—18", "18—20"].map(x => `<span class="col-label">${x}</span>`).join("")}${rows.map((r, ri) => `<span class="row-label">${r[0]}</span>${r.slice(1).map((v, i) => `<span class="cell ${ri === 0 && i === 2 ? "target" : v >= 80 ? "high" : v >= 55 ? "medium" : ""}">${v}%</span>`).join("")}`).join("")}</div><div class="legend"><span><i></i>较低</span><span><i class="medium"></i>中等</span><span><i class="high"></i>较高</span><span class="spacer"></span><span>分布差异需要结合人员与项目解释</span></div></section>`;
  }
  function hqHome() {
    const n = nextStep();
    return heading("连锁经营 / 总部", "把经营变化，变成门店行动", "澄禾护理 · 3 家直营门店 · 本周经营观察 10.12—10.18", `<span class="scope-chip">${icon("Buildings")}全部直营门店 ${badge("模拟")}</span>`)
      + `<div class="metrics">${metric("完成服务", "186", "人次", "覆盖 3 / 3 家门店", "", true)}${metric("服务完成金额", "49,848", "元", "按服务完成口径 · 不含储值", "", true)}${metric("商品销售净额", "3,115", "元", "商品订单单独计算", "", true)}${metric("10月21日已有预约", "38", "笔", "基准快照 · 不含本轮新增", "", true)}</div>
      <div class="main-grid"><div class="stack"><section class="issue-hero"><div class="between"><div class="issue-icon">${icon("ChartLineUp")}</div>${badge(phase(), "blue dot")}</div><h2>下午有空档，<br>晚间却在等。</h2><p>湖滨店的预约集中在晚间。先核实下午是否具备接待条件，再选择适合的顾客与时段，避免一轮统一促销放大晚间压力。</p><div class="issue-numbers"><div><strong>42<em>%</em></strong><small>下午预约占用率</small></div><div><strong>90<em>%</em></strong><small>晚间预约占用率</small></div><div><strong>${state.checked ? "2" : "待核"}<em>${state.checked ? "个" : ""}</em></strong><small>可新增服务时段</small></div></div><div class="actions flex">${btn(state.reviewed ? "查看完整复盘" : "进入经营事项", "navigate", "primary", "ArrowRight", `data-route="hq-issue" data-tab="${state.reviewed ? "review" : "evidence"}"`)}${btn("查看依据", "evidence", "", "ChartLineUp")}</div></section>
      <section class="card"><div class="card-head"><div><h2>直营门店经营</h2><p>同一观察期 · 服务与商品分开呈现</p></div>${badge("3 家门店")}</div><div class="table-wrap"><table><thead><tr><th>门店</th><th>完成服务</th><th>服务完成金额</th><th>商品净额</th><th>当前关注</th></tr></thead><tbody>${[["湖滨店",54,14472,995,"时段分布不均"],["城西店",63,16884,1020,"经营平稳"],["滨江店",69,18492,1100,"经营平稳"]].map((r,i)=>`<tr><td><strong>${r[0]}</strong><span class="sub">${i === 0 ? "本轮试点门店" : "用于对照观察"}</span></td><td>${r[1]} 人次</td><td>¥${fmt(r[2])}</td><td>¥${fmt(r[3])}</td><td>${i===0?btn(r[4],"navigate","text small","ArrowUpRight",'data-route="hq-issue"'):badge(r[4],"teal")}</td></tr>`).join("")}</tbody></table></div></section>${heatmap()}</div>
      <aside class="stack">${agentCard()}<section class="card compact"><div class="card-head"><h2>总部待处理</h2>${badge(state.reviewed ? "已完成" : "1 项", state.reviewed ? "teal" : "amber")}</div><div class="mini-item">${icon(state.checked&&!state.supportArranged?"Package":"Target","iconbox")}<div><strong>${n.title}</strong><p>${n.text}</p>${btn("前往处理","next","text small","ArrowRight")}</div></div></section>${logCard(3)}</aside></div>`;
  }
  function evidenceTab() {
    return `<section class="card"><div class="card-head"><h2>先区分事实与待核原因</h2>${btn("查看原始依据","evidence","text small","ArrowUpRight")}</div><div class="evidence-grid"><div class="evidence-card"><span class="eyebrow">下午 14:00—16:00</span><div class="value">42% <span>前期 58%</span></div><div class="bar"><i style="width:42%"></i></div><p>预约占用率下降 16 个百分点；不能据此认定人员闲置。</p></div><div class="evidence-card"><span class="eyebrow">晚间 18:00—20:00</span><div class="value">90% <span>前期 88%</span></div><div class="bar"><i style="width:90%"></i></div><p>部分项目出现候位，需要核查顾客时间偏好与技能限制。</p></div></div><div class="gap">${notice("观察期：10.12—10.18；对照期：10.05—10.11。全部资料均为合成演示数据。")}</div><div class="fact-row">${icon("CheckCircle","fact-icon")}<div><h3>已知事实：同店的时段分布有差异</h3><p>该变化值得关注，因为继续统一引流可能增加晚间压力。</p></div></div><div class="fact-row">${icon("WarningCircle","warning")}<div><h3>待核查：下午空档是否真的可以接待</h3><p>需要同时确认护理人员、房间、服务时长和耗材。</p></div></div><div class="gap">${!state.checkRequested?btn("发起门店核查","request-check","primary","PaperPlaneTilt"):state.checked?notice("门店核查已返回：人员与房间可用；需补充 2 份护理耗材。","teal"):notice("已请求湖滨店核查，等待店长确认现场情况。","blue")}</div></section>
      ${state.checkRequested&&!state.checked?handoff("store-task","交给湖滨店核查","门店 Agent 将协助店长确认三个接待条件。","切换到门店核查"):state.checked?`<section class="card"><div class="card-head"><h2>门店现场反馈</h2>${badge("店长已确认","teal")}</div><p class="muted small">${esc(state.storeNote)}</p><div class="gap">${btn("查看方案与资源","issue-tab","primary","ArrowRight",'data-tab="plan"')}</div></section>`:""}`;
  }
  function planTab() {
    if(!state.checked) return `<section class="card">${empty("先完成门店核查","方案需要真实可执行的前提。当前还未收到门店对人员、房间和耗材的确认。",state.checkRequested?"去门店核查":"发起核查",state.checkRequested?"store-task":"hq-issue",!state.checkRequested?"evidence":"")}</section>`;
    return `<section class="card"><div class="card-head"><div><h2>选择一条符合门店条件的行动</h2><p>仅湖滨店试点 · 原价服务 · 14:00、15:00 各一个时段</p></div>${badge("方案 v1","blue")}</div><div class="stack-sm"><div class="plan-option selected">${icon("CheckCircle","blue-text")}<div><strong>精准跟进有需求的顾客</strong><p>不调整价格；先确认接待能力，再由员工联系 3 位适合跟进的顾客。</p></div></div><div class="plan-option">${icon("Circle","faint")}<div><strong>扩大统一促销</strong><p>本轮不采用：可能继续增加晚间需求，且需要额外预算与权益确认。</p></div></div></div><dl class="kv gap"><dt>目标</dt><dd>验证下午空档能否转成实际完成的服务</dd><dt>总部要求</dt><dd>268 元 / 60 分钟；不移动已确认的晚间预约；不重复联系顾客</dd><dt>门店可调整</dt><dd>具体联系顺序、人员分工；时段变更需要重新核查</dd><dt>完成凭据</dt><dd>联系结果、顾客意愿、预约确认记录</dd><dt>观察结果</dt><dd>实际到店、服务完成、取消或改约、商品关联销售</dd></dl></section>
      <section class="card"><div class="card-head"><h2>总部需要提供的支持</h2>${badge(state.supportReceived?"门店已确认到位":state.supportArranged?"已安排 · 待门店确认到位":"待处理",state.supportReceived?"teal":state.supportArranged?"blue":"amber")}</div><div class="mini-item">${icon("Package","iconbox")}<div><strong>补充 2 份护理耗材</strong><p>负责人：陈敏 · 今日 13:00 前安排到店。门店确认收到后才允许开始联系。</p></div></div><div class="gap">${!state.supportArranged?btn("确认安排耗材补充","support","primary","Check"):notice(state.supportReceived?"门店已确认耗材到位。":"已安排补充，尚未收到门店到货确认。",state.supportReceived?"teal":"blue")}</div></section>
      <section class="card"><div class="card-head"><h2>湖滨店将收到的任务</h2>${btn("预览任务","task-preview","text small","ArrowUpRight")}</div><div class="task-summary"><h3>核实准备后，跟进适合下午到店的顾客</h3><p>责任人：店长李安 · 执行人：小林<br>截止：10月20日 17:00 完成跟进与预约确认</p></div><div class="gap">${state.published?handoff("store-task","任务已下发湖滨店","方案 v1 已记录，总部支持与门店执行将持续回传。","切换到门店接收"):btn("确认方案并下发任务","publish","primary","PaperPlaneTilt",!state.supportArranged?'disabled title="先安排耗材支持"':"")}</div></section>`;
  }
  function executionTab() {
    if(!state.published) return `<section class="card">${empty("任务尚未下发","核查完成后，先确认方案与资源，再安排门店执行。","查看方案","hq-issue","plan")}</section>`;
    const items=[["门店接收",state.accepted,"李安接收，并安排小林执行"],["耗材到位",state.supportReceived,"2 份耗材由门店确认收到"],["服务规则",state.trained,"价格、权益与联系边界已确认"],["顾客联系",state.contacted.length===3,`${state.contacted.length} / 3 位适合跟进顾客已联系`],["预约确认",state.bookings.length===2,`${state.bookings.length} / 2 个时段完成预约确认`],["提交执行记录",state.executionSubmitted,"门店核对记录后提交总部验收"]];
    return `<section class="card"><div class="card-head"><div><h2>湖滨店执行情况</h2><p>店长李安负责 · 小林执行 · 方案 v1</p></div>${badge(phase(),"blue")}</div>${items.map((x,i)=>`<div class="task-step ${x[1]?"done":""}"><span class="step-circle">${x[1]?icon("Check"):i+1}</span><div class="step-content"><h3>${x[0]}</h3><p>${x[2]}</p></div>${badge(x[1]?"已完成":"待完成",x[1]?"teal":"")}</div>`).join("")}<div class="gap">${state.executionSubmitted&&!state.executionAccepted?btn("验收执行记录，进入观察期","accept-execution","primary","ShieldCheck"):state.executionAccepted?notice("执行验收已通过。实际到店与服务结果单独观察。","teal"):nav("前往门店继续执行","store-task","primary")}</div></section>
      <section class="card"><div class="card-head"><h2>预约凭据</h2>${badge("本地模拟记录")}</div>${state.bookings.length?bookingTable():notice("还没有本轮确认的预约。发出联系或生成话术，不会自动记作预约。")}</section>`;
  }
  function bookingTable() {
    return `<div class="table-wrap"><table><thead><tr><th>顾客</th><th>日期 / 时段</th><th>人员与房间</th><th>状态</th></tr></thead><tbody>${state.bookings.map(b=>`<tr><td>${M.customers.find(c=>c.id===b.customerId).name}</td><td>10.21 ${b.slot}<span class="sub">60 分钟 · 268 元</span></td><td>${b.staff}<span class="sub">${b.room}</span></td><td>${badge(state.outcomeReady?"服务已完成":"预约已确认","teal")}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function reviewTab() {
    if(!state.executionAccepted) return `<section class="card">${empty("先让行动真正完成","门店提交执行记录、总部验收后，再观察实际到店与服务结果。","查看执行进展","hq-issue","execution")}</section>`;
    if(!state.outcomeReady) return `<section class="card"><div class="card-head"><h2>执行已完成，等待观察结果</h2>${badge("观察中","blue")}</div><div class="journey"><div class="node">已联系<b>3</b></div>${icon("ArrowRight")}<div class="node">确认预约<b>2</b></div>${icon("ArrowRight")}<div class="node">实际到店<b>待观察</b></div></div>${notice("当前只能确认预约记录，尚不能得出完成服务或经营改善的结论。","amber")}<div class="gap"><h3>演示下一天会发生什么</h3><p class="small muted gap-sm">点击后将载入预设的 10月21日模拟结果，不会读取真实系统。</p>${btn("载入次日模拟服务结果","observe","primary gap","Play")}</div></section>`;
    const d=M.derived(state);
    return `<section class="card"><div class="card-head"><div><h2>从预约，看到实际服务结果</h2><p>观察日 10月21日 · 仅本轮行动关联的顾客与订单</p></div>${badge("模拟结果","teal")}</div><div class="journey"><div class="node">适合跟进<b>3</b></div>${icon("ArrowRight")}<div class="node">同意并预约<b>2</b></div>${icon("ArrowRight")}<div class="node">实际完成<b>${d.completed}</b></div></div><div class="result-grid"><div class="result-tile"><span>服务完成</span><strong>${d.completed} <small>人次</small></strong><small>未到店 0 · 取消 0</small></div><div class="result-tile"><span>服务完成金额</span><strong>¥${fmt(d.serviceAmount)}</strong><small>2 × 268 元</small></div><div class="result-tile"><span>商品关联销售</span><strong>¥${d.retail}</strong><small>日常洗护 1 件</small></div></div>${bookingTable()}<div class="gap">${notice("原晚间预约转移 0 笔。服务金额与商品金额分别展示；本轮没有储值交易。","teal")}</div><div class="result-quote">本轮证明：门店条件得到核实，支持与执行有回执，2 位顾客完成服务。<br><strong>尚未证明：这项策略造成了净增收入，或可以直接推广到所有门店。</strong></div><p class="small muted">只有一店两位顾客，没有对照实验；后续应比较可比时段，并继续记录取消、改约和重复需求。</p></section>
      <section class="card"><div class="card-head"><h2>${state.reviewed?"已保存的经营决定":"确认下一步经营决定"}</h2>${state.reviewed?badge("已复盘","teal"):badge("待负责人确认","amber")}</div>${state.reviewed?`<div class="task-summary"><h3>${esc(state.decision)}</h3><p>${esc(state.reviewNote)}</p></div><div class="gap">${btn("查看完整协作记录","all-log","","ClipboardText")}</div>`:`<label class="field"><span>后续决定</span><select id="review-decision"><option>小范围继续验证</option><option>暂停并调整</option></select></label><label class="field"><span>复盘备注</span><textarea id="review-note" maxlength="600">先在湖滨店继续观察一周，保留原价与联系边界；比较相似时段，不将这两次完成服务解释为已证实的增量。</textarea></label>${btn("确认复盘并保存决定","review","primary","CheckCircle")}`}</section>`;
  }
  function hqIssue() {
    return `${heading("经营事项 / 湖滨店", "让下午空档，变成可执行的接待计划", "从资料核查到门店执行，两端围绕同一条事项协作。",badge(phase(),"blue dot"))}<div class="meta-row" style="margin-top:-10px;margin-bottom:20px"><span>${icon("UserCircle")}负责人 王宁</span><span>${icon("Storefront")}试点 湖滨店</span><span>${icon("CalendarBlank")}10.20 执行 · 10.21 观察</span><span>${icon("ShieldCheck")}模拟事项 CH-1020</span></div><div class="main-grid"><div class="stack"><div class="tabs" aria-label="事项内容">${[["evidence","问题与依据"],["plan","方案与资源"],["execution","门店执行"],["review","结果与复盘"]].map(([id,text])=>`<button type="button" data-action="issue-tab" data-tab="${id}" class="${issueTab===id?"active":""}" ${issueTab===id?'aria-current="page"':""}>${text}</button>`).join("")}</div>${({evidence:evidenceTab,plan:planTab,execution:executionTab,review:reviewTab})[issueTab]()}</div><aside class="stack">${agentCard()}${logCard()}</aside></div>`;
  }
  function empty(title, text, label="", dest="", tab="") {
    return `<div class="empty">${icon("Clock")}<h3>${title}</h3><p>${text}</p>${label?btn(label,"navigate","primary small","ArrowRight",`data-route="${dest}" data-tab="${tab}"`):""}</div>`;
  }
  function storeHome() {
    const d = M.derived(state), n = nextStep();
    const taskTitle = !state.checked ? "核实下午的人员、房间与耗材" : !state.published ? "等待总部安排耗材与确认方案" : !state.accepted ? "接收总部任务，安排本店执行" : !state.supportReceived ? "先确认耗材到位" : !state.trained ? "确认联系与服务规则" : !state.responses ? "跟进适合下午到店的顾客" : state.bookings.length<2 ? "根据顾客意愿确认预约" : !state.executionSubmitted ? "检查记录，向总部提交执行结果" : !state.outcomeReady ? "预约已确认，等待实际到店" : "服务结果已回传，查看本轮复盘";
    return heading("湖滨店 / 店长李安", state.outcomeReady ? "今天的服务结果，已经回到经营事项" : "今天先把接待准备好", `${state.outcomeReady?"10月21日 · 模拟观察日":"10月20日 · 模拟执行日"}　｜　头皮清洁护理 · 60 分钟 / 次`, `<span class="scope-chip">${icon("Storefront")}湖滨店</span>`)
      + `<div class="metrics">${metric("本次任务可用时段",state.checked?"2":"待核",state.checked?"个":"","")}${metric("已完成联系",state.contacted.length,"位","仅本轮适合跟进顾客")}${metric("新增确认预约",state.bookings.length,"笔","不含原有晚间预约")}${metric("已完成服务",state.outcomeReady?d.completed:"待观察",state.outcomeReady?"人次":"","")}</div>
      <div class="main-grid"><div class="stack"><section class="card"><div class="card-head"><h2>今日优先行动</h2>${badge(phase(),"teal dot")}</div><div class="priority-card"><div class="between"><span class="priority-number">1</span>${badge(!state.checkRequested?"等待总部核查请求":state.published?"总部任务 · v1":"总部核查","teal")}</div><h2>${taskTitle}</h2><p>目标是把已核实的下午空档转成实际服务。先确认现场条件，再安排人员和顾客，执行结果回到同一条事项。</p><div class="gap flex wrap">${state.checkRequested?nav("打开行动详情","store-task","primary"):nav("去总部发起核查","hq-issue","primary")}${state.published?nav("查看相关顾客","customers",""):btn("为什么先做这件事","evidence","","Info")}</div></div><div class="mini-item gap">${icon("BookOpen","iconbox")}<div><strong>工作支持：联系前，先看服务与权益规则</strong><p>原价 268 元；按顾客意愿预约；不要承诺未确认的时段。</p>${btn("查看工作支持","learning","text small","ArrowRight")}</div></div></section>
      <section class="card"><div class="card-head"><div><h2>10月21日 · 接待安排</h2><p>展示本次行动的时段，以及一条已有晚间预约</p></div>${badge("小林 / 小雨")}</div><div class="timeline">${M.slots.map(slot=>{const b=state.bookings.find(b=>b.slot===slot);return `<div class="appointment"><time>${slot}</time><div><strong>${b?M.customers.find(c=>c.id===b.customerId).name+" · 头皮清洁护理":"待安排 · 头皮清洁护理"}</strong><p>小林 / A 护理间 · 60 分钟</p>${b?btn("打开顾客","customer","text small","ArrowUpRight",`data-id="${b.customerId}"`):nav("从适合的顾客中安排","customers","text small")}</div>${badge(b?(state.outcomeReady?"已完成服务":"预约已确认"):state.checked?"已核实空档":"接待条件待核",b?"teal":"")}</div>`;}).join("")}<div class="appointment"><time>17:30</time><div><strong>周女士 · 头皮清洁护理</strong><p>小雨 / B 护理间 · 原有预约，本次不调整</p>${btn("打开顾客","customer","text small","ArrowUpRight",'data-id="c3"')}</div>${badge("已有预约")}</div></div></section>
      <section class="card"><div class="card-head"><h2>顾客待办</h2>${nav("全部顾客","customers","text small","ArrowUpRight")}</div><div class="two-col"><div class="mini-item">${icon("ChatsCircle","iconbox")}<div><strong>${state.responses?"回应已整理":"3 位适合跟进的顾客"}</strong><p>${state.responses?"2 位愿意预约，1 位暂不预约。":"有需求记录，当前没有重复联系或既有预约。"} </p></div></div><div class="mini-item">${icon("ShieldCheck","iconbox")}<div><strong>3 位自动排除</strong><p>已有预约、近期已联系或不接收营销联系。</p></div></div></div></section></div>
      <aside class="stack">${agentCard(true)}<section class="card compact"><div class="card-head"><h2>总部协作</h2>${badge(state.supportArranged?"已回复":"待协调",state.supportArranged?"teal":"")}</div><div class="mini-item">${icon("Package","iconbox")}<div><strong>${state.supportReceived?"耗材已到位":state.supportArranged?"总部已安排 2 份耗材":"耗材支持"}</strong><p>${state.supportReceived?"现场条件已确认，可按方案执行。":state.supportArranged?"陈敏负责，门店到货后确认。":"先核查现场，再向总部明确需要的支持。"} </p>${btn(n.title,"next","text small","ArrowRight")}</div></div></section>${logCard(3)}</aside></div>`;
  }
  function checkTask() {
    if(!state.checkRequested) return `<section class="card">${empty("还没有待核查的事项","请先在总部的经营事项中发起现场核查。","前往总部","hq-issue","evidence")}</section>`;
    if(state.checked) return `<section class="card"><div class="card-head"><h2>门店核查已提交</h2>${badge("已确认","teal")}</div><div class="task-summary"><h3>人员与房间可用，耗材需补充 2 份</h3><p>${esc(state.storeNote)}</p></div><div class="gap">${handoff("hq-issue","等待总部解决支持并确认方案","总部需要先安排耗材，再下发具体顾客跟进任务。","切换到总部","plan")}</div></section>`;
    return `<section class="card"><div class="card-head"><h2>现场核查 · 三个接待条件</h2>${badge("店长确认","teal")}</div><p class="small muted" style="margin-bottom:18px">请核对下面的模拟现场资料，再向总部提交结果。核查不代表开始联系顾客。</p><div class="stack-sm">${[["staff","小林具备技能，14:00—16:00 可用","项目为头皮清洁护理，每次 60 分钟。排班与技能均需确认。"],["room","A 护理间可用，设备状态正常","两个时段顺序使用同一护理间，没有其他预约占用。"],["supply","发现耗材缺口，需要补充 2 份","现有耗材不足，向总部提出明确支持请求。"]].map(([key,title,text])=>`<label class="check-row ${state.checks[key]?"checked":""}"><input type="checkbox" data-check="${key}" ${state.checks[key]?"checked":""}><span><strong>${title}</strong><p>${text}</p></span></label>`).join("")}</div><label class="field"><span>补充现场说明</span><textarea id="store-note" maxlength="600" placeholder="可以补充门店现场约束">小林和 A 护理间可接待 10月21日 14:00、15:00 两次护理；需补充 2 份护理耗材，收到后才能开始执行。</textarea></label>${btn("提交核查并申请耗材支持","submit-check","primary","PaperPlaneTilt",!Object.values(state.checks).every(Boolean)?"disabled":"")}</section>`;
  }
  function taskStep(num,title,text,done,action="") {
    return `<div class="task-step ${done?"done":""}"><span class="step-circle">${done?icon("Check"):num}</span><div class="step-content"><h3>${title}</h3><p>${text}</p>${action}</div>${done?badge("已完成","teal"):""}</div>`;
  }
  function executeTask() {
    const d=M.derived(state);
    return `<section class="card"><div class="card-head"><div><h2>跟进适合下午到店的顾客</h2><p>总部任务 v1 · 店长李安负责 · 小林执行</p></div>${badge(phase(),"teal")}</div><div class="task-summary"><h3>为什么现在做</h3><p>本店已核实两个下午空档。通过明确的顾客需求与合适时段，验证能否完成接待；不打折，不挪动已有预约。</p></div><dl class="kv gap"><dt>服务</dt><dd>头皮清洁护理 · 60 分钟 · 268 元</dd><dt>时段</dt><dd>10月21日 14:00、15:00</dd><dt>人员 / 房间</dt><dd>小林 / A 护理间</dd><dt>完成凭据</dt><dd>顾客意愿与预约确认；后续单独观察服务结果</dd></dl>${!state.accepted?`<div class="gap">${btn("接收任务，安排小林执行","accept","primary","CheckCircle")}</div>`:""}</section>
      <section class="card"><div class="card-head"><h2>执行清单</h2>${badge(`${[state.supportReceived,state.trained,state.contacted.length===3,state.bookings.length===2,state.executionSubmitted].filter(Boolean).length} / 5`,"teal")}</div>
      ${taskStep(1,"确认耗材已经到位","总部安排与实际到货分别记录。请店长确认 2 份耗材已收到。",state.supportReceived,state.supportReceived?"":btn("确认模拟耗材已到位","receive","small","Package",!state.accepted?"disabled":""))}
      ${taskStep(2,"阅读联系与服务规则","原价服务；只联系适合跟进顾客；先确认时段，再承诺预约。",state.trained,btn(state.trained?"再次查看规则":"阅读并确认执行规则","learning","small","BookOpen",!state.accepted?"disabled":""))}
      ${taskStep(3,"联系 3 位适合跟进的顾客","先检查名单与联系偏好，再确认话术。所有联系均为本地模拟。",state.contacted.length===3,nav("进入顾客工作页","customers",d.canContact?"primary small":"small","Users"))}
      ${taskStep(4,"根据顾客意愿确认预约",state.responses?"2 位顾客愿意预约。每次预约都需要选择可用时段，并检查冲突。":"顾客意愿尚待确认。后续根据回应选择可用时段，并检查冲突。",state.bookings.length===2,`${state.responses?nav("查看回应与预约","customers","small","CalendarBlank"):notice("取得顾客回应后，才可以确认预约。")}`)}
      ${taskStep(5,"核对记录并提交总部","提交表示执行凭据齐全；服务是否完成，需要后续业务记录。",state.executionSubmitted,state.executionSubmitted?notice(state.executionAccepted?"总部已验收通过，正在观察结果。":"已提交，等待总部验收。",state.executionAccepted?"teal":"blue"):btn("提交执行记录","submit-execution","primary small","PaperPlaneTilt",!d.canSubmit?"disabled":""))}
      </section>${state.executionSubmitted?handoff("hq-issue",state.executionAccepted?"结果回到总部经营事项":"交给总部验收执行记录",state.executionAccepted?"进入结果观察与复盘，避免把预约当作服务完成。":"总部检查准备、联系与预约记录，再进入观察期。",state.executionAccepted?"查看结果与复盘":"切换到总部验收",state.executionAccepted?"review":"execution"):""}
      <section class="card"><div class="card-head"><h2>遇到阻碍时</h2></div><p class="small muted">人员、房间或顾客需求发生变化时，先反馈具体约束，由对应负责人协调。</p><div class="gap">${btn("查看本轮支持请求","support-detail","","ChatsCircle")}</div></section>`;
  }
  function storeTask() {
    return `${heading("湖滨店 / 行动详情",state.published?"把行动落实到人员、时段和顾客":"先核实门店能不能接待",state.published?"每个步骤保留完成记录，资源不足时可以向总部请求支持。":"总部提出问题，门店补充现场事实，共同决定下一步。",badge(phase(),"teal dot"))}<div class="main-grid"><div class="stack">${state.published?executeTask():checkTask()}</div><aside class="stack">${agentCard(true)}${logCard(4)}</aside></div>`;
  }
  function customerStatus(c) {
    const b=state.bookings.find(b=>b.customerId===c.id);
    if(b) return {label:state.outcomeReady?"服务已完成":"本轮预约已确认",tone:"teal"};
    if(state.responses&&state.contacted.includes(c.id)) return {label:c.response,tone:c.response==="同意预约"?"blue":""};
    if(state.contacted.includes(c.id)) return {label:"已联系 · 待回应",tone:"blue"};
    return {label:c.status,tone:c.eligible?"teal":c.id==="c5"?"rose":"amber"};
  }
  function customerRows() {
    const visible=M.customers.filter(c=>(customerFilter==="all"||customerFilter==="eligible"&&c.eligible||customerFilter==="excluded"&&!c.eligible)&&(!query||`${c.name}${c.owner}${c.preference}`.includes(query)));
    return visible.length?visible.map(c=>{const status=customerStatus(c);const b=state.bookings.find(b=>b.customerId===c.id);return `<tr><td><input type="checkbox" class="selection-box" aria-label="选择${c.name}" data-customer-check="${c.id}" ${selected.has(c.id)?"checked":""} ${!c.eligible||state.contacted.includes(c.id)?"disabled":""}></td><td><div class="customer-name"><span class="avatar ${c.color}">${c.initials}</span><div><button type="button" data-action="customer" data-id="${c.id}">${c.name}</button><span class="sub">负责人 ${c.owner} · ${c.last} 到店</span></div></div></td><td>${c.preference}<span class="sub">${c.eligible?"有需求记录，可由员工确认后跟进":"本轮排除，保留原因"}</span></td><td>${badge(status.label,status.tone)}</td><td>${state.responses&&c.response==="同意预约"&&!b?btn("确认预约","booking","small","CalendarBlank",`data-id="${c.id}"`):btn("查看详情","customer","text small","ArrowUpRight",`data-id="${c.id}"`)}</td></tr>`;}).join(""):`<tr><td colspan="5"><div class="empty">没有匹配的顾客，试试其他名字或筛选条件。</div></td></tr>`;
  }
  function customersPage() {
    const d=M.derived(state);
    const fresh=[...selected].filter(id=>!state.contacted.includes(id));
    return heading("湖滨店 / 顾客", "知道该跟进谁，也知道为什么", "顾客工作页 · 模拟档案与预约 · 未连接 CRM 或消息渠道",`<span class="scope-chip">${icon("ShieldCheck")}模拟客户资料</span>`)
      + `<div class="main-grid"><div class="stack">${!d.canContact&&!state.executionSubmitted?notice("开始联系前，请在行动详情中接收任务、确认耗材到位，并阅读执行规则。","amber"):""}<section class="card"><div class="card-head"><div><h2>下午时段 · 顾客跟进清单</h2><p>按实际需求、现有预约和近期联系记录筛选</p></div>${nav("返回行动","store-task","text small","ArrowLeft")}</div><div class="customer-counts"><div><strong>6</strong>相关顾客</div><div><strong>3</strong>适合跟进</div><div><strong>${state.bookings.length}</strong>确认预约</div><div><strong>3</strong>本轮排除</div></div><div class="customer-toolbar"><label class="search">${icon("MagnifyingGlass")}<input type="search" id="customer-search" placeholder="搜索顾客、负责人" value="${esc(query)}" aria-label="搜索顾客"></label><div class="filter-pills">${[["all","全部顾客"],["eligible","适合跟进"],["excluded","本轮排除"]].map(([id,label])=>`<button type="button" data-action="customer-filter" data-filter="${id}" class="${customerFilter===id?"active":""}" aria-pressed="${customerFilter===id}">${label}</button>`).join("")}</div></div><div class="table-wrap"><table class="customer-table"><thead><tr><th><span class="sr-only">选择</span></th><th>顾客</th><th>跟进依据</th><th>当前状态</th><th>操作</th></tr></thead><tbody id="customer-rows">${customerRows()}</tbody></table></div><div class="customer-bulk"><p id="selection-count">已选 <strong>${fresh.length}</strong> 位可联系顾客<br>尊重联系偏好，已有预约不重复安排。</p>${state.contacted.length===3?btn(state.responses?"回应已整理":"载入模拟顾客回应","responses",state.responses?"":"primary","ChatsCircle",state.responses?"disabled":""):btn("检查名单与联系草稿","contact-preview","primary","PaperPlaneTilt",!d.canContact||!fresh.length?"disabled":"")}</div></section>
      ${state.responses?`<section class="card"><div class="card-head"><h2>顾客回应与可用时段</h2>${badge("预设模拟回应","teal")}</div><div class="mini-list"><div class="mini-item">${icon("CheckCircle","positive")}<div><strong>林女士、陈女士愿意预约</strong><p>分别偏好 14:00 与 15:00。请根据实际可用时段办理，每个时段最多接待一位。</p></div></div><div class="mini-item">${icon("Info","muted")}<div><strong>何女士这次暂不预约</strong><p>结束本轮跟进，保留回应；不会自动追加联系任务。</p></div></div></div><div class="gap">${state.bookings.length===2?handoff("store-task","两条预约均已确认","回到行动详情，核对记录后提交总部。","返回行动提交"):notice(`${2-state.bookings.length} 个时段尚可安排。请点击顾客行的“确认预约”。`,"blue")}</div></section>`:`<section class="card"><div class="card-head"><h2>把顾客信息放回一次完整服务</h2>${btn("查看资料归属","crm-info","text small","Info")}</div><div class="two-col"><div class="mini-item">${icon("CalendarBlank","iconbox")}<div><strong>预约与服务记录</strong><p>人员、工位、时段与结果关联到同一顾客。</p></div></div><div class="mini-item">${icon("Package","iconbox")}<div><strong>服务与商品分开记录</strong><p>商品购买可与服务关联，保持各自订单明细。</p></div></div></div><p class="customer-card-note">本原型的顾客均为虚构，不包含真实联系方式。卡项和交易仅展示，未提供扣款或核销操作。</p></section>`}</div><aside class="stack">${agentCard(true)}<section class="card compact"><div class="card-head"><h2>联系前检查</h2></div><div class="mini-list">${[["CalendarBlank","已有预约先排除","周女士已有晚间预约。"],["Clock","近期联系不重复","许女士正在等待回复。"],["Prohibit","尊重联系偏好","赵女士不接收营销联系。"]].map(([i,t,p])=>`<div class="mini-item">${icon(i,"iconbox")}<div><strong>${t}</strong><p>${p}</p></div></div>`).join("")}</div></section></aside></div>`;
  }
  function render() {
    $("#app").innerHTML=shell(({ "hq-home":hqHome,"hq-issue":hqIssue,"store-home":storeHome,"store-task":storeTask,customers:customersPage })[route]());
    document.title=`${({"hq-home":"总部今日经营","hq-issue":"经营事项","store-home":"门店今日","store-task":"门店行动","customers":"门店顾客"})[route]} · NEO 交互原型`;
  }
  function openModal(type,id="") {
    lastFocus=document.activeElement;modal={type,id};
    let title="",body="",foot="",drawer=false;
    if(type==="guide") {
      title="用一个场景，走完两端协作";
      body=`${notice("这是可操作的模拟原型。按钮会改变状态并同步到两端；没有真实系统连接或外部消息发送。","blue")}<div class="gap">${[["总部发现问题","在今日经营打开事项，查看依据并发起门店核查。"],["门店核实现场","确认人员、护理间和耗材；向总部反馈耗材缺口。"],["总部安排执行","安排耗材，预览任务并确认下发。"],["门店落实到顾客","接收任务、确认准备；检查名单、模拟联系、载入回应、分别预约。"],["总部验收与观察","核对执行记录后，载入次日模拟到店与服务结果。"],["共同复盘","查看服务与商品结果，确认下一步决定。"]].map(([t,p],i)=>`<div class="guide-step"><span class="num">${i+1}</span><div><b>${t}</b><p>${p}</p></div></div>`).join("")}</div><div class="gap">${notice("进度会保存在本浏览器；可以自由切换五个页面。右上角“重置”可重新体验。")}</div>`;
      foot=btn("继续当前步骤","next","primary","ArrowRight");
    } else if(type==="reset") {
      title="重置这次模拟演示？";
      body=`<p class="muted">将清除本原型在这个浏览器保存的核查、任务、预约与复盘进度，回到最初发现问题的状态。</p><div class="gap">${notice("只影响本地模拟原型，不涉及 NEO 的其他数据或真实业务系统。")}</div>`;
      foot=btn("保留进度","close","")+btn("重置演示","confirm-reset","primary","ArrowCounterClockwise");
    } else if(type==="evidence") {
      title="经营依据 · 湖滨店";
      body=`${notice("全部为合成演示资料，日期用于串联场景。","blue")}<dl class="kv gap"><dt>观察期</dt><dd>2026.10.12—10.18</dd><dt>对照期</dt><dd>2026.10.05—10.11</dd><dt>下午占用</dt><dd>42% ← 58%（下降 16 个百分点）</dd><dt>晚间占用</dt><dd>90% ← 88%</dd><dt>统计口径</dt><dd>对应时段内，已预约服务时长 / 可预约服务时长；仅可比的人员与服务项目</dd><dt>资料来源</dt><dd>模拟预约表、模拟人员排班与服务时长配置</dd></dl><div class="gap">${notice("预约占用率反映分布差异；空档是否真的可以接待，还要核查技能、房间、设备和耗材。","amber")}</div>`;
      foot=btn("返回页面","close","primary");
    } else if(type==="task-preview") {
      title="门店将收到的任务";
      body=`<div class="task-summary"><h3>跟进适合下午到店的顾客</h3><p>湖滨店 · 责任人李安 · 执行人小林</p></div><dl class="kv gap"><dt>为什么做</dt><dd>核实后的两个下午空档需要验证实际接待机会。</dd><dt>服务条件</dt><dd>头皮清洁护理，60 分钟，268 元；10.21 14:00 / 15:00。</dd><dt>前置条件</dt><dd>2 份耗材到位，员工确认执行规则。</dd><dt>总部统一</dt><dd>不打折；不挪动原有预约；尊重联系意愿。</dd><dt>门店安排</dt><dd>确定联系顺序与人员分工，反馈现场变化。</dd><dt>凭据</dt><dd>联系回应、预约确认、后续到店与服务记录。</dd></dl>`;
      foot=btn("返回方案","close","primary");
    } else if(type==="learning") {
      title="工作支持 · 服务与联系规则";
      body=`<div class="task-summary"><h3>头皮清洁护理</h3><p>标准时长 60 分钟 · 原价 268 元 · 小林具备对应技能<br>模拟知识版本 v1 · 适用湖滨店本轮任务</p></div><div class="gap mini-list">${[["先准备","核实人员、护理间、设备与耗材。任务安排不代表资源已经到位。"],["再联系","只跟进有需求、允许联系且没有重复任务的顾客。先询问意愿。"],["再确认","预约必须检查时段、人员和房间，不能先承诺后补记录。"],["服务后","服务完成与商品购买分别记录；回访围绕顾客反馈，不强行推销。"]].map(([t,p])=>`<div class="mini-item">${icon("CheckCircle","positive")}<div><strong>${t}</strong><p>${p}</p></div></div>`).join("")}</div><div class="gap">${notice("本页是原型中的工作支持材料，未验证员工技能或培训效果。")}</div>`;
      foot=state.accepted&&!state.trained?btn("已阅读，确认本次执行规则","train","primary","Check"):btn("返回工作台","close","primary");
    } else if(type==="support-detail") {
      title="耗材支持 · 两端共同跟进";
      body=`<dl class="kv"><dt>门店请求</dt><dd>补充 2 份护理耗材，满足两次服务准备。</dd><dt>提出者</dt><dd>湖滨店店长李安</dd><dt>总部责任人</dt><dd>王宁；配送负责人陈敏</dd><dt>总部安排</dt><dd>${state.supportArranged?"已安排，计划 10.20 13:00 前到位":"等待总部安排"}</dd><dt>门店回执</dt><dd>${state.supportReceived?"店长已确认模拟到货":"尚未确认到位"}</dd></dl><div class="gap">${notice("本轮阻碍是耗材缺口。支持请求有明确负责人，并在总部和门店同时显示。","blue")}</div>`;
      foot=btn("返回任务","close","primary");
    } else if(type==="all-log") {
      title=`完整协作记录 · ${state.events.length} 条`;
      body=`<div class="log">${state.events.slice().reverse().map(e=>`<div class="log-item"><small>${e.time} · ${esc(e.actor)}</small><strong>${esc(e.title)}</strong><p>${esc(e.detail)}</p></div>`).join("")}</div>`;
      foot=btn("返回页面","close","primary");
    } else if(type==="crm-info") {
      title="顾客工作页与业务系统的分工";
      body=`<p class="small muted">正式产品中，顾客工作页优先连接企业原有系统。本版所有记录均保存在浏览器，不连接任何系统。</p><dl class="kv gap"><dt>原有系统</dt><dd>顾客身份、会员权益、预约占用、支付与退款、库存。</dd><dt>NEO</dt><dd>经营判断、顾客跟进任务、人员协作、执行与复盘。</dd><dt>写入确认</dt><dd>实际预约需收到业务系统确认；消息草稿不等于已经发送。</dd><dt>本轮演示</dt><dd>用本地模拟记录演示确认结果、时段冲突与两端状态同步。</dd></dl>`;
      foot=btn("我知道了","close","primary");
    } else if(type==="customer") {
      const c=M.customers.find(c=>c.id===id);
      if(!c) return;
      const b=state.bookings.find(b=>b.customerId===id),status=customerStatus(c);
      title="顾客详情";drawer=true;
      body=`<div class="customer-detail-head"><span class="avatar large ${c.color}">${c.initials}</span><div><h2>${c.name}</h2><p>${c.phone} · 非真实联系方式</p></div></div><div class="flex wrap">${badge(status.label,status.tone)}${badge(c.card)}${badge("负责人 "+c.owner)}</div><div class="gap"><h3>当前跟进依据</h3><p class="small muted gap-sm">${c.note}</p></div><div class="gap">${notice(c.eligible?"员工检查顾客意愿、可用时段和近期联系记录后，再采取行动。":"本次不进入联系名单："+c.note,c.eligible?"teal":"amber")}</div><div class="gap"><h3>顾客时间线</h3><div class="log gap">${c.history.split(" · ").map(x=>`<div class="log-item"><strong>${x}</strong><p>模拟业务记录</p></div>`).join("")}${state.contacted.includes(id)?`<div class="log-item"><strong>10.20 完成模拟联系</strong><p>${state.responses?c.response:"等待顾客回应"}</p></div>`:""}${b?`<div class="log-item"><strong>10.21 ${b.slot} · ${state.outcomeReady?"服务已完成":"预约已确认"}</strong><p>小林 / A 护理间 · 268 元</p></div>`:""}${state.outcomeReady&&id==="c1"?`<div class="log-item"><strong>10.21 日常洗护商品 · 89 元</strong><p>独立商品订单，与本次服务关联。</p></div>`:""}</div></div><div class="gap"><h3>联系偏好与权益</h3><dl class="kv gap-sm"><dt>联系偏好</dt><dd>${c.preference}</dd><dt>会员 / 卡项</dt><dd>${c.card} · 模拟展示</dd><dt>数据归属</dt><dd>正式产品由原系统维护，本页读取并关联任务。</dd></dl></div>`;
      foot=state.responses&&c.response==="同意预约"&&!b?btn("选择时段并确认预约","booking","primary","CalendarBlank",`data-id="${id}"`):btn("返回顾客列表","close","primary");
    } else if(type==="contact-preview") {
      const ids=[...selected].filter(id=>!state.contacted.includes(id));
      title="检查名单与联系草稿";
      body=`${notice("这是模拟联系。确认后只更新本地记录，不会向任何人发送消息。","blue")}<div class="gap"><h3>本次名单</h3><div class="flex wrap gap-sm">${ids.map(id=>{const c=M.customers.find(c=>c.id===id);return badge(c.name+" · "+c.preference,"teal");}).join("")}</div></div><label class="field"><span>联系草稿 · 可以修改后确认</span><textarea id="contact-draft" maxlength="800" style="min-height:135px">您好，您之前关注的头皮清洁护理，明天下午有两个可安排的时段。如果您仍有需要，我们可以帮您核实合适的时间。项目为 60 分钟，原价 268 元。您看方便了解一下吗？</textarea></label><div class="gap">${notice("已有预约、近期已联系和不接收营销联系的顾客已排除。后续收到顾客意愿，再确认具体时段。")}</div>`;
      foot=btn("返回检查","close","")+btn("确认模拟联系","contact","primary","PaperPlaneTilt");
    } else if(type==="booking") {
      const c=M.customers.find(c=>c.id===id);
      if(!c) return;
      title=`为${c.name}确认预约`;
      const available=M.slots.filter(slot=>!state.bookings.some(b=>b.slot===slot));
      const defaultSlot=available.includes(c.slot)?c.slot:available[0];
      body=`<div class="customer-detail-head"><span class="avatar ${c.color}">${c.initials}</span><div><h3>${c.name}已同意预约</h3><p>偏好 ${c.slot} · 以员工确认的最终时段为准</p></div></div><dl class="kv"><dt>项目</dt><dd>头皮清洁护理 · 60 分钟 · 268 元</dd><dt>日期</dt><dd>2026年10月21日</dd><dt>人员 / 房间</dt><dd>小林 / A 护理间</dd></dl><div class="booking-slots gap">${M.slots.map(slot=>{const busy=state.bookings.find(b=>b.slot===slot);return `<label class="slot ${busy?"disabled":""}"><input type="radio" name="booking-slot" value="${slot}" ${slot===defaultSlot?"checked":""} ${busy?"disabled":""}><strong>${slot}</strong><span>${busy?"已被"+M.customers.find(c=>c.id===busy.customerId).name+"预约":"已核实可用 · 60 分钟"}</span></label>`;}).join("")}</div><div class="gap">${notice("点击后生成本地模拟预约确认记录；同一时段不能重复占用。","teal")}</div>`;
      foot=btn("返回顾客","close","")+btn("确认模拟预约","book","primary","CheckCircle",`data-id="${id}" ${available.length?"":"disabled"}`);
    }
    $("#overlay").innerHTML=`<div class="overlay-backdrop ${drawer?"drawer-backdrop":""}" data-backdrop="true"><section class="dialog ${drawer?"drawer":""}" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1"><header class="dialog-head"><h2 id="dialog-title">${title}</h2>${btn("","close","ghost icon","X",'aria-label="关闭弹窗"')}</header><div class="dialog-body">${body}</div><footer class="dialog-foot">${foot}</footer></section></div>`;
    $("#app").inert=true;document.body.style.overflow="hidden";
    setTimeout(()=>$("#overlay .dialog")?.focus(),0);
  }
  function closeModal(restore=true) {
    modal=null;$("#overlay").innerHTML="";$("#app").inert=false;document.body.style.overflow="";
    if(restore&&lastFocus?.isConnected) lastFocus.focus();
  }
  function ask(question) {
    const raw=question==="why"?"为什么值得关注？":question==="next"?"下一步做什么？":question==="boundary"?"能证明有效吗？":question;
    let answer="";
    if(/有效|证明|增量|复盘|收入/.test(raw)) answer="本轮只验证协作和执行记录。即使 2 位顾客完成服务，也不能据此认定策略带来因果增量；还需要可比时段、更多样本，并检查改约与取消。";
    else if(/耗材|资源|阻碍/.test(raw)) answer=state.supportReceived?"门店已确认两份耗材到位。总部安排和门店收到各自有记录，可以继续按已确认方案执行。":state.supportArranged?"总部已安排陈敏补充两份耗材。请门店确认实际到位后再开始联系顾客。":"门店需要两份护理耗材。先提交核查与支持请求，再由总部安排责任人和到位时间。";
    else if(/为什么|关注|原因/.test(raw)) answer="湖滨店下午预约占用率为 42%，晚间为 90%，提示时段需求与供给可能不匹配。当前只是值得核查的信号，还需要现场资料支持原因判断。";
    else if(/顾客|客户|名单|联系/.test(raw)) answer="3 位有需求记录且适合跟进。周女士已有预约，许女士近期已联系，赵女士不接收营销联系，因此本轮排除。实际联系与预约都需要员工确认。";
    else if(/预约|时段|冲突/.test(raw)) answer="本轮只有 10月21日 14:00 和 15:00 两个时段，均为 60 分钟，由小林使用 A 护理间服务。已占用的时段不能重复预约。";
    else {const n=nextStep();answer=`当前建议：${n.title}。${n.text} 此问答为预设场景演示，仅覆盖当前协作流程。`;}
    const box=$("#agent-answer");if(box){box.hidden=false;box.className="agent-answer";box.innerHTML=`<strong>${esc(raw)}</strong><p>${answer}</p>`;}
  }
  document.addEventListener("click",e=>{
    if(e.target.dataset?.backdrop){closeModal();return;}
    const target=e.target.closest("[data-action]");
    if(!target||target.disabled)return;
    const action=target.dataset.action;
    const messages={
      "request-check":"核查已发起。切换到湖滨店补充现场情况。",
      "support":"总部已安排补充耗材，仍需门店确认到位。",
      "publish":"方案 v1 已下发湖滨店。",
      "accept":"任务已接收，小林负责执行。",
      "receive":"模拟耗材已确认到位。",
      "train":"执行规则已确认。",
      "responses":"已载入预设回应：2 位愿意预约，1 位暂不预约。",
      "submit-execution":"执行记录已提交，等待总部验收。",
      "accept-execution":"执行验收通过，进入观察期。",
      "observe":"已载入 10月21日模拟服务结果。",
    };
    if(action==="navigate"){go(target.dataset.route,target.dataset.tab);return;}
    if(action==="next"){const n=nextStep();go(n.dest,n.tab);return;}
    if(action==="issue-tab"){issueTab=target.dataset.tab;render();return;}
    if(action==="stage"){
      const i=Number(target.dataset.index),d=M.derived(state);
      if(i>d.stage){toast("先完成当前步骤，后续阶段会随协作推进。");return;}
      const steps=[["hq-home"],["store-task"],["hq-issue","plan"],["store-task"],["hq-issue","review"],["hq-issue","review"]];
      go(...steps[i]);return;
    }
    if(action==="customer-filter"){customerFilter=target.dataset.filter;render();return;}
    if(action==="ask"){ask(target.dataset.question);return;}
    if(action==="close"){closeModal();return;}
    if(action==="confirm-reset"){
      state=M.seed();issueTab="evidence";selected=new Set(["c1","c2","c6"]);customerFilter="all";query="";
      save();go("hq-home");toast("模拟演示已重置。");return;
    }
    if(action==="submit-check"){
      if(commit(action,{note:$("#store-note")?.value},"核查已提交，并向总部申请两份耗材支持。")){}
      return;
    }
    if(action==="contact"){
      const text=$("#contact-draft")?.value.trim();
      if(!text){toast("请先填写联系草稿。",true);return;}
      commit(action,{ids:[...selected],draft:text},"模拟联系已记录，没有发送外部消息。");return;
    }
    if(action==="book"){
      const slot=$('input[name="booking-slot"]:checked')?.value;
      if(!slot){toast("请选择一个可用时段。",true);return;}
      commit(action,{customerId:target.dataset.id,slot},"模拟预约已确认，并已同步两端进度。");return;
    }
    if(action==="review"){
      commit(action,{decision:$("#review-decision").value,note:$("#review-note").value},"复盘与经营决定已保存，本轮协作完成。");return;
    }
    if(messages[action]){
      if(commit(action,{},messages[action])){
        if(action==="publish")issueTab="execution";
        if(action==="accept-execution"||action==="observe")issueTab="review";
        render();
      }return;
    }
    if(["guide","reset","evidence","task-preview","learning","support-detail","all-log","crm-info","customer","contact-preview","booking"].includes(action))openModal(action,target.dataset.id);
  });
  document.addEventListener("change",e=>{
    const el=e.target;
    if(el.dataset.check){
      const draft=$("#store-note")?.value;
      if(commit("check",{key:el.dataset.check,value:el.checked})&&$("#store-note"))$("#store-note").value=draft;
    }
    if(el.dataset.customerCheck){
      if(el.checked)selected.add(el.dataset.customerCheck);else selected.delete(el.dataset.customerCheck);
      render();
    }
  });
  document.addEventListener("input",e=>{
    if(e.target.id==="customer-search"){query=e.target.value;$("#customer-rows").innerHTML=customerRows();}
  });
  document.addEventListener("submit",e=>{
    e.preventDefault();
    if(e.target.id==="agent-form"){const input=e.target.querySelector("input");if(input.value.trim()){ask(input.value.trim());input.value="";}}
  });
  document.addEventListener("keydown",e=>{
    if(!modal)return;
    if(e.key==="Escape"){e.preventDefault();closeModal();return;}
    if(e.key==="Tab"){
      const items=[...$("#overlay").querySelectorAll('button:not(:disabled), input:not(:disabled), select, textarea, a[href], [tabindex="0"]')].filter(el=>!el.hidden);
      const first=items[0],last=items.at(-1);
      if(!first)return;
      if(e.shiftKey&&(document.activeElement===first||document.activeElement===$(".dialog"))){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  window.addEventListener("hashchange",()=>{
    const next=location.hash.slice(1);
    if(routes.includes(next)){route=next;closeModal(false);render();window.scrollTo(0,0);}
  });
  render();
})();
