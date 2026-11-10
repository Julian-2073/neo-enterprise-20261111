import raw from "./neo-demo-data.json";

export const demo = raw;
export const stageKeys = ["A1", "A2", "A3", "A4"] as const;
export const stageNames = ["看过", "兴趣", "意向", "有效成交"] as const;
export const peopleTotals = demo.conversion.stageTotals;
export const totalConversion = peopleTotals.A4 / peopleTotals.A3;
export const weeklyConversion = demo.conversion.stageWeekly.A4.map((value, index) => value / demo.conversion.stageWeekly.A3[index]);
export const conversionSteps = [
  peopleTotals.A2 / peopleTotals.A1,
  peopleTotals.A3 / peopleTotals.A2,
  peopleTotals.A4 / peopleTotals.A3,
];
export const previousConversion = demo.conversion.previousComparablePeriod.a3ToA4Ratio;
export const contributionShares = [
  demo.financial.variableCost / demo.financial.netRevenue,
  demo.financial.advertisingSpend / demo.financial.netRevenue,
  demo.financial.contributionMargin / demo.financial.netRevenue,
];
export const inventoryTotal = demo.productRoles.reduce((sum, role) => sum + role.currentInventoryCost, 0);
export const roleCompliance = demo.productRoles.map((role) => role.qualifiedSkuWeekly.map((count) => count / role.skuCount));
export const marketSpendTotal = demo.market.channelSpends.reduce((sum, channel) => sum + channel.amount, 0);
export const normalizedPeople = Object.fromEntries(stageKeys.map((key) => {
  const values = demo.conversion.stageWeekly[key];
  const baseline = values.slice(0, 4).reduce((sum, value) => sum + value, 0) / 4;
  return [key, values.map((value) => value / baseline * 100)];
})) as Record<(typeof stageKeys)[number], number[]>;

export const money = (value: number) => `¥${value.toLocaleString("zh-CN")}`;
export const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
export const pp = (value: number, digits = 1) => `${(value * 100).toFixed(digits)} 个百分点`;

export type Scope = "conversion" | "inventory" | "channelSpend" | "r1Stock" | "supply";
export type Evidence = { id: string; title: string; kind: string; value: string; source: string; date: string; scope: string; note: string };

export const evidenceRecords: Evidence[] = [
  { id: "conversion-gap", title: "意向到成交阶段比值", kind: "内部演示事实", value: `${percent(totalConversion)} · 前期 ${percent(previousConversion)} · 变化 −${pp(previousConversion - totalConversion)}`, source: "统一演示数据：R1 / 抖音 / 近 8 周", date: "2026-09-24", scope: demo.scopes.conversion.label, note: "八周汇总比值。它与最后一周单周比值不同；数据是演示人数，不代表已完成客户去重。" },
  { id: "weekly-intent", title: "第 7–8 周 A3 与 A4 走势", kind: "内部演示事实", value: `意向 ${demo.conversion.stageWeekly.A3.slice(-2).join(" → ")} · 成交 ${demo.conversion.stageWeekly.A4.slice(-2).join(" → ")}`, source: "统一演示数据：R1 / 抖音 / 分周", date: "2026-09-20", scope: demo.scopes.conversion.label, note: "两个相邻周显示 A3 上升而 A4 下降，是需核查的趋势错位，不足以证明原因。" },
  { id: "supply-core", title: "主力成交品供给达标", kind: "内部演示事实", value: `${demo.productRoles[1].currentQualifiedSkuCount}/${demo.productRoles[1].skuCount} · ${percent(demo.productRoles[1].currentQualifiedSkuCount / demo.productRoles[1].skuCount)}`, source: "三类商品供给样例", date: "2026-09-24", scope: demo.scopes.supply.label, note: "以达标 SKU 数除以该角色 SKU 总数。第 7、8 周低于演示目标 80%。" },
  { id: "stock-r1", title: "R1 当前库存与在途", kind: "库存演示事实", value: `${demo.products.find((p) => p.id === "R1")?.sellableUnits} 件可售 · 180 件在途 · 2026-10-06 预计到货`, source: "统一演示商品数据", date: "2026-09-24", scope: demo.scopes.r1Stock.label, note: "当前可售库存成本 58,000 元；到货日期与数量都是模拟记录，不能触发真实采购或调拨。" },
  { id: "market-events", title: "外部事件与渠道变化同期出现", kind: "模拟外部观察", value: "09.12 竞品促销 · 09.16 投放单价变化", source: "交接包标注为演示来源，待验证", date: "2026-09-16", scope: demo.scopes.channelSpend.label, note: "时间重合仅表示同期观察，不构成竞品导致转化变化的因果证据。" },
];

export function getEvidence(id?: string | null) {
  return evidenceRecords.find((e) => e.id === id) ?? evidenceRecords[0];
}

export function getAgent(page: string) {
  const id = ({ people: "conversion", goods: "supply", market: "market", overview: "joint", future: "orchestrator" } as Record<string, string>)[page];
  return demo.agents.find((agent) => agent.id === id) ?? demo.agents[0];
}

export function getReply(agentId: string, message: string) {
  const value = message.toLowerCase();
  if (/因果|原因|竞品|活动|市场|同期/.test(value)) return "目前只能确认这些模拟观察同期出现。可以继续对照分渠道转化、库存和客服承接；现有演示证据不足以确定因果。";
  if (/库存|补货|在途|调拨|sku|到货/.test(value)) return "R1 演示数据为 42 件可售、80 件安全库存、180 件在途，预计 10 月 6 日到货。建议先核实到货与跨仓可售量；此处不会创建采购或调拨任务。";
  if (/预算|投放|方案|情景|提前/.test(value)) return "可在方案卡中比较预算与到货假设。当前仅提供交接包中的预设样例；补充条件需人工核实，不会自动改写预测。";
  if (/流失|转化|成交|人群|渠道/.test(value)) return "近两周 A3 从 375 增至 400，A4 从 33 降至 32。八周 A3→A4 比值为 12.5%，前一等长八周为 15.7%；优先核查客服承接和可售库存。";
  return "当前演示没有覆盖这类问题。可查看已有证据，或补充需要核查的经营条件；新补充的信息会标记为待核实，不会改写演示事实。";
}
