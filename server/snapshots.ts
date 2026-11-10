import {activePlatformSettings} from './platform-settings.ts';
import {financialMetrics} from '../lib/business-metrics.ts';
import type { Context } from "./auth.ts";
import { CALCULATION_VERSION, type Batch, type DataNature, type Fact, type Snapshot, type SnapshotData, type StoredFact } from "./contracts.ts";
import { businessDate, dateOnly, hash, parseTime } from "./csv.ts";
import { assert } from "./errors.ts";
import { all, first, statement } from "./store.ts";
import { eventStages } from "./templates.ts";
import {readMaterials} from "./materials/validation.ts";
import {projectMaterials,validateFunnelRule} from "./materials/projection.ts";
import type {CustomerFunnelRule} from "./materials/contracts.ts";
import {customerJourney} from './customer-journey.ts';
import {importedPeriod} from './imported-period.ts';
type InputFact = StoredFact & {
    fact: Fact;
};
export function addDays(day: string, days: number) { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function defaultPeriod(asOf: string) {
    const day = new Date(`${asOf}T00:00:00Z`).getUTCDay();
    const end = addDays(asOf, -(day === 0 ? 7 : day));
    return { start: addDays(end, -55), end };
}
function safeSum(values: number[]) {
    const result = values.reduce((sum, n) => sum + BigInt(n), BigInt(0));
    assert(result <= BigInt(Number.MAX_SAFE_INTEGER) && result >= BigInt(Number.MIN_SAFE_INTEGER), 422, "TOTAL_OVERFLOW", "汇总超出安全整数范围，请缩小统计范围");
    return Number(result);
}
function covers(batches: Batch[], kind: string, start: string, end: string) {
    const sources = new Map<string, Batch[]>();
    for (const b of batches.filter(b => b.kind === kind))
        sources.set(b.source_id, [...(sources.get(b.source_id) ?? []), b]);
    if (!sources.size)
        return false;
    // Every contributing source needs coverage; different partial sources cannot fill each other's gaps.
    return [...sources.values()].every(group => {
        let next = start;
        for (const b of group.sort((a, b) => a.coverage_start.localeCompare(b.coverage_start))) {
            if (b.coverage_start <= next && b.coverage_end >= next)
                next = addDays(b.coverage_end, 1);
        }
        return next > end;
    });
}
export function calculate(facts: InputFact[], batches: Batch[], start: string, end: string, allowCoveredZeros = true): Omit<SnapshotData, "inventory" | "channels" | "weeks"> {
    const within = facts.filter(r => r.fact.business_date >= start && r.fact.business_date <= end);
    const orders = within.filter(r => r.kind === "orders");
    const expenses = within.filter(r => r.kind === "expenses");
    const orderAvailable = orders.length > 0 || allowCoveredZeros && covers(batches, "orders", start, end);
    const expenseAvailable = expenses.length > 0 || allowCoveredZeros && covers(batches, "expenses", start, end);
    const paidIds = new Set(orders.filter(r => r.fact.entry_type === "paid").map(r => `${r.source_id}:${r.fact.order_id}`));
    const revenue = orderAvailable ? safeSum(orders.map(r => (r.fact.entry_type === "refund" ? -1 : 1) * r.fact.amount_cents!)) : null;
    const spend = expenseAvailable ? safeSum(expenses.map(r => r.fact.amount_cents!)) : null;
    const cost = orderAvailable && orders.every(r => r.fact.variable_cost_cents !== null) ? safeSum(orders.map(r => (r.fact.entry_type === "refund" ? -1 : 1) * r.fact.variable_cost_cents!)) : null;
    const canonical=financialMetrics(within.map(r=>({kind:r.kind,sourceId:r.source_id,id:r.id,fact:r.fact})),batches.map(b=>({kind:b.kind,sourceId:b.source_id,start:b.coverage_start,end:b.coverage_end})),start,end);
    const margin = canonical.contributionMarginCents.value;
    return {
        financial: { paidOrders: orderAvailable ? paidIds.size : null, netRevenueCents: revenue, spendCents: spend, variableCostCents: cost, contributionMarginCents: margin },
        events: Object.fromEntries(["A1", "A2", "A3", "A5"].map(stage => {
            const rows = within.filter(r => r.kind === "events" && eventStages[r.fact.event_type!] === stage);
            return [stage, rows.length ? safeSum(rows.map(r => r.fact.quantity!)) : null];
        })),
    };
}
export async function createSnapshot(ctx: Context, input: {
    dataNature: DataNature;
    asOf?: string;
    periodStart?: string;
    periodEnd?: string;
    periodMode?: 'all_imported' | 'window';
    productId?: string | null;
    channel?: string | null;
    knownAt?: string;
    customerFunnel?: CustomerFunnelRule|null;
}) {
    const capturedAt=new Date().toISOString();
    const knownAt=input.knownAt?parseTime(input.knownAt):capturedAt;
    assert(!input.knownAt||/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.knownAt),422,"KNOWN_AT","知识截止需带时区时间");
    assert(Date.parse(knownAt)<=Date.parse(capturedAt),422,"KNOWN_AT","知识截止不可晚于当前系统时间");
    const platform=await activePlatformSettings(ctx,input.dataNature,knownAt);
    // A later import reuses the last saved business rule unless the caller
    // explicitly replaces or disables it. Historical knowledge never reads
    // a rule that was saved after that cutoff; tenant/nature stay isolated.
    const previousRule=await first<{payload:string}>(ctx.db,"SELECT payload FROM operating_snapshots WHERE business_id=? AND data_nature=? AND generated_at<=? ORDER BY generated_at DESC,id DESC LIMIT 1",ctx.businessId,input.dataNature,knownAt);
    const customerFunnel=validateFunnelRule(input.customerFunnel===undefined&&platform.id?platform.settings.customerFunnel:input.customerFunnel===undefined?(previousRule?JSON.parse(previousRule.payload).data?.materials?.customerAnalysis?.rule??null:null):input.customerFunnel);
    assert(!input.channel||customerFunnel?.channelPolicy!=="any",422,"FUNNEL_SCOPE","跨渠道转化规则需选择全渠道快照；不能用单渠道支付记录评价全渠道转化");
    const materialRows=await readMaterials(ctx,input.dataNature,knownAt);
    assert(materialRows.length<=10000,413,"MATERIAL_LIMIT","资料超过10000条版本，请缩小资料集合");
    const sourceFacts = await all<StoredFact>(ctx.db, `SELECT f.* FROM business_facts f JOIN ingestion_batches b ON b.id=f.batch_id WHERE f.business_id=? AND f.data_nature=? AND b.status='committed' AND b.committed_at<=? AND f.kind IN ('events','orders','inventory','expenses')
    AND (? IS NULL OR json_extract(f.payload,'$.product_id')=?) AND (? IS NULL OR json_extract(f.payload,'$.channel')=? OR f.kind='inventory') ORDER BY f.business_date LIMIT 10001`, ctx.businessId, input.dataNature,knownAt, input.productId ?? null, input.productId ?? null, input.channel ?? null, input.channel ?? null);
    assert(sourceFacts.length <= 10000, 413, "SNAPSHOT_LIMIT", "首版快照最多处理 10,000 条事实，请按商品/渠道缩小范围");
    const parsed = sourceFacts.map(r => ({ ...r, fact: JSON.parse(r.payload) as Fact }));
    const asOf = dateOnly(input.asOf || parsed.reduce((latest, r) => r.fact.business_date > latest ? r.fact.business_date : latest, "") || businessDate(new Date().toISOString()));
    assert(input.periodMode===undefined||input.periodMode==='all_imported'||input.periodMode==='window',422,'PERIOD_MODE','统计期间模式无效');
    const inheritedMode=previousRule?JSON.parse(previousRule.payload).periodMode:undefined;
    const fullHistory=input.periodMode==='all_imported'||input.periodMode===undefined&&!input.periodStart&&!input.periodEnd&&inheritedMode==='all_imported';
    assert(!fullHistory||!input.periodStart&&!input.periodEnd,422,'PERIOD_MODE','全部已导入期间由后端计算，不能同时指定统计起止日期');
    const batches = await all<Batch>(ctx.db, "SELECT * FROM ingestion_batches WHERE business_id=? AND data_nature=? AND status='committed' AND committed_at<=?", ctx.businessId, input.dataNature,knownAt);
    const defaults = fullHistory?importedPeriod(parsed,batches,asOf):defaultPeriod(asOf);
    if(platform.id&&!fullHistory)defaults.start=addDays(defaults.end,-(platform.settings.statisticsWeeks*7-1));
    const start = dateOnly(input.periodStart || defaults.start);
    const end = dateOnly(input.periodEnd || defaults.end);
    assert(start <= end && end <= asOf && Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`) <= 365 * 86400000, 422, "INVALID_PERIOD", "统计范围须在截至日内且不超过 366 天");
    const available = parsed.filter(r => r.fact.business_date <= asOf);
    const within = available.filter(r => r.kind !== "inventory" && r.fact.business_date >= start && r.fact.business_date <= end);
    const latestInventory = new Map<string, InputFact>();
    for (const r of available.filter(r => r.kind === "inventory").sort((a, b) => a.fact.occurred_at.localeCompare(b.fact.occurred_at)))
        latestInventory.set(JSON.stringify([r.fact.warehouse_id, r.fact.sku_id]), r);
    const stocks = [...latestInventory.values()];
    const includedIds = [...new Set([...within, ...stocks].map(r => r.batch_id).concat(batches.filter(b => b.coverage_start <= end && b.coverage_end >= start).map(b => b.id)))].sort();
    const signature = await hash(JSON.stringify([ctx.businessId, input.dataNature, asOf, start, end, input.productId ?? null, input.channel ?? null, CALCULATION_VERSION,...(fullHistory?['all_imported']:[]),...(platform.id?[platform.id]:[]),input.knownAt?knownAt:null,customerFunnel,materialRows.filter(r=>r.fact.effective_from!<=asOf).map(r=>r.id).sort(), sourceFacts.map(f => f.id).sort(), batches.map(b => [b.id, b.coverage_start, b.coverage_end]).sort()]));
    const id = `snap-${signature}`;
    const prior = await first<{
        payload: string;
    }>(ctx.db, "SELECT payload FROM operating_snapshots WHERE id=? AND business_id=?", id, ctx.businessId);
    if (prior)
        return JSON.parse(prior.payload) as Snapshot;
    const evidence: Array<{
        id: string;
        key: string;
        title: string;
        formula: string;
        value: unknown;
        unit: string;
        factIds: string[];
    }> = [];
    const makeEvidence = (key: string, title: string, formula: string, value: unknown, unit: string, rows: InputFact[]) => {
        const eid = `${id}:${key}`;
        evidence.push({ id: eid, key, title, formula, value, unit, factIds: rows.map(r => r.id) });
        return eid;
    };
    const allowCoveredZeros = !input.productId && !input.channel;
    const data = calculate(available, batches, start, end, allowCoveredZeros);
    const unallocatedExpenses = input.productId ? await first<{
        n: number;
    }>(ctx.db, "SELECT COUNT(*) AS n FROM business_facts f JOIN ingestion_batches b ON b.id=f.batch_id WHERE f.business_id=? AND f.data_nature=? AND f.kind='expenses' AND f.business_date>=? AND f.business_date<=? AND json_extract(f.payload,'$.product_id') IS NULL AND b.status='committed' AND b.committed_at<=?", ctx.businessId, input.dataNature, start, end,knownAt) : null;
    if (unallocatedExpenses?.n)
        data.financial.contributionMarginCents = null;
    const evidenceIds: Record<string, string> = {};
    for (const [key, value] of Object.entries(data.financial))
        evidenceIds[key] = makeEvidence(key, ({ paidOrders: "支付订单数", netRevenueCents: "净成交额", spendCents: "投放费用", variableCostCents: "变动成本", contributionMarginCents: "贡献毛利" } as Record<string, string>)[key], ({ paidOrders: "按来源及订单 ID 去重支付订单", netRevenueCents: "同期支付额 − 同期退款额", spendCents: "同期广告投放费用之和", variableCostCents: "支付成本 − 退款成本回转", contributionMarginCents: "净成交额 − 变动成本 − 广告投放费用；要求成本及期间覆盖完整" } as Record<string, string>)[key], value, key === "paidOrders" ? "笔" : "人民币分", within.filter(r => key === "spendCents" ? r.kind === "expenses" : key === "contributionMarginCents" ? ["orders", "expenses"].includes(r.kind) : r.kind === "orders"));
    for (const [stage, value] of Object.entries(data.events))
        evidenceIds[stage] = makeEvidence(stage, `${stage} 行为量`, "已导入行为事件数量之和；不是去重人数", value, "次", within.filter(r => r.kind === "events" && eventStages[r.fact.event_type!] === stage));
    evidenceIds.operatingPulse = makeEvidence("operatingPulse", "行为与支付订单", "分别汇总行为次数与去重支付订单笔数；不同单位不计算客户转化率", {events:data.events,paidOrders:data.financial.paidOrders}, "次/笔", within.filter(r=>r.kind==="events" || r.kind==="orders"));
    const inventory = stocks.map(r => ({ ...r.fact, factId: r.id, evidenceId: makeEvidence(`stock-${r.id}`, `${r.fact.sku_id} / ${r.fact.warehouse_id} 库存`, "该仓库/SKU在截至日前的最新已导入快照", r.fact, "件/人民币分", [r]) }));
    const inventoryCostCents = stocks.length && stocks.every(r => r.fact.inventory_cost_cents !== null && r.fact.inventory_cost_cents !== undefined)
        ? safeSum(stocks.map(r => r.fact.inventory_cost_cents!)) : null;
    evidenceIds.inventoryCostCents = makeEvidence("inventoryCostCents", "已导入库存成本货值", "各仓库/SKU截至日前最新已导入库存成本之和；要求参与记录成本完整，不代表企业全部库存", inventoryCostCents, "人民币分", stocks);
    const channels = [...new Set(within.map(r => r.fact.channel).filter((c): c is string => !!c))].sort().map(channel => {
        const rows = available.filter(r => r.fact.channel === channel);
        const values = calculate(rows, batches, start, end, false).financial;
        // A file-level declaration cannot prove that an absent channel has zero values.
        if (!within.some(r => r.kind === "orders" && r.fact.channel === channel)) {
            values.paidOrders = null;
            values.netRevenueCents = null;
        }
        if (!within.some(r => r.kind === "expenses" && r.fact.channel === channel))
            values.spendCents = null;
        return { channel, paidOrders: values.paidOrders, netRevenueCents: values.netRevenueCents, spendCents: values.spendCents, evidenceId: makeEvidence(`channel-${encodeURIComponent(channel)}`, `${channel} 经营记录`, "按渠道筛选同一统计期的订单、退款及费用", values, "笔/人民币分", within.filter(r => r.fact.channel === channel)) };
    });
    const weeks: SnapshotData["weeks"] = [];
    for (let week = start; week <= end;) {
        const weekday = new Date(`${week}T00:00:00Z`).getUTCDay();
        const sunday = addDays(week, weekday === 0 ? 0 : 7 - weekday);
        const weekEnd = sunday > end ? end : sunday;
        const values = calculate(available, batches, week, weekEnd, allowCoveredZeros);
        weeks.push({ start: week, end: weekEnd, events: values.events, paidOrders: values.financial.paidOrders, netRevenueCents: values.financial.netRevenueCents, spendCents: values.financial.spendCents });
        evidenceIds[`week:${week}`] = makeEvidence(`week-${week}`, `${week} 至 ${weekEnd} 周期数据`, "按自然日筛选；不足完整自然周时显示实际区间", values, "次/笔/人民币分", within.filter(r => r.fact.business_date >= week && r.fact.business_date <= weekEnd));
        week = addDays(weekEnd, 1);
    }
    const limitations = ["库存不按销售渠道筛选，按仓库和商品/SKU展示。", "仅汇总已导入来源；覆盖日期是提供者声明，未经业务核实。", "行为次数、支付订单数与客户人数不同；转化仅按已关联客户和完整观察窗口计算。", "库存是各仓库/SKU最近一次已导入值，不保证企业全量或实时。", "退款计入实际发生日，可能使该期净成交额为负。"];
    for (const kind of ["events", "orders", "expenses"])
        if (!covers(batches, kind, start, end))
            limitations.push(`${kind} 未完整覆盖统计期；缺失日期不能当成零。`);
    if (unallocatedExpenses?.n)
        limitations.push("存在未归属商品的投放费用，商品贡献毛利待费用分摊。");
    if (data.financial.contributionMarginCents === null)
        limitations.push("成本或费用/订单期间覆盖不足，贡献毛利待补数据。");
    const materials=projectMaterials(materialRows,available,{dataNature:input.dataNature,knownAt,asOf,start,end,productId:input.productId,channel:input.channel,weeks,customerFunnel,observationCovered:covers(batches,"orders",start,asOf)&&covers(batches,"events",start,end)});
    const materialEvidenceRows=materialRows.filter(r=>materials.sourceFactIds.includes(r.id));
    evidenceIds.materials=makeEvidence("materials","有效经营资料","按业务有效区间与系统知识截止选择不可变资料版本",materials.domain,"对象",materialEvidenceRows);
    const customerEvidenceRows=[...materialEvidenceRows,...within.filter(r=>["events","orders"].includes(r.kind)),...available.filter(r=>r.kind==="orders"&&r.fact.entry_type==="paid"&&r.fact.business_date>end)];
    evidenceIds.customerAnalysis=makeEvidence("customerAnalysis","客户关联与队列","规范客户去重；仅成熟观察窗口计算所配置的阶段到支付转化",materials.customerAnalysis,"客户/比例",customerEvidenceRows);
    evidenceIds.supply=makeEvidence("supply","货盘与供给","每仓库/SKU最新观测，按业务日有效SKU角色与明确供给规则评价",materials.supply,"件/比例",[...materialEvidenceRows,...available.filter(r=>r.kind==="inventory"),...within.filter(r=>r.kind==="orders")]);
    for(const r of [...materialEvidenceRows,...customerEvidenceRows])if(!includedIds.includes(r.batch_id))includedIds.push(r.batch_id);
    if(materials.quality.unresolvedReferences)limitations.push("历史兼容事实存在未贯通主数据，不把引用键当已核实对象。");
    const snap: Snapshot = {...(fullHistory?{periodMode:'all_imported' as const}:{}),...(platform.id?{platformConfigId:platform.id}:{}),knownAt,domain:materials.domain, id, businessId: ctx.businessId, businessName: ctx.businessName, dataNature: input.dataNature, asOf, periodStart: start, periodEnd: end, productId: input.productId ?? null, channel: input.channel ?? null, timezone: "Asia/Shanghai", generatedAt: capturedAt, calculationVersion: CALCULATION_VERSION, batchIds: includedIds, coverage: batches.filter(b => includedIds.includes(b.id)).map(b => ({ batchId: b.id, kind: b.kind, sourceId: b.source_id, start: b.coverage_start, end: b.coverage_end })), dataStatus: input.dataNature === "demo" ? "demo" : "partial", limitations, data: { ...data, materials,inventoryCostCents, inventory, channels, weeks }, evidenceIds };
    // Derived once at snapshot publication, using the exact same facts,
    // identities, source coverage and configured rule as the saved evidence.
    // Changing inputs or the calculation version creates a new immutable ID.
    evidenceIds.customerJourney=`${id}:customerJourney`;
    snap.data.customerJourney=customerJourney(snap,available.map(r=>({id:r.id,kind:r.kind,sourceId:r.source_id,fact:r.fact})));
    makeEvidence('customerJourney','4A 客户旅程','按规范客户身份去重；每环节首次进入后在配置窗口内依序转化，同渠道策略由业务规则决定；两个四周窗口各自留出同等观察时间',snap.data.customerJourney,'客户/比例',customerEvidenceRows);
    const statements = [statement(ctx.db, "INSERT OR IGNORE INTO operating_snapshots(id,business_id,data_nature,generated_at,payload) VALUES(?,?,?,?,?)", id, ctx.businessId, input.dataNature, snap.generatedAt, JSON.stringify(snap))];
    // At most ~1 MiB per JSON parameter; avoid thousands of per-row statements.
    statements.push(statement(ctx.db, `INSERT OR IGNORE INTO evidence_records(id,business_id,snapshot_id,payload) SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.payload') FROM json_each(?)`, ctx.businessId, id, JSON.stringify(evidence.map(e => ({ id: e.id, payload: JSON.stringify({ ...e, factIds: undefined, snapshotId: id, businessId: ctx.businessId, periodStart: start, periodEnd: end, asOf, dataStatus: snap.dataStatus, limitations, batchIds: includedIds, sourceCount: e.factIds.length }) })))));
    const links = evidence.flatMap(e => e.factIds.map(fid => ({ id: `${e.id}/${fid}`, e: e.id, f: fid })));
    for (let n = 0; n < links.length; n += 500)
        statements.push(statement(ctx.db, "INSERT OR IGNORE INTO evidence_facts(id,evidence_id,fact_id) SELECT json_extract(value,'$.id'),json_extract(value,'$.e'),json_extract(value,'$.f') FROM json_each(?)", JSON.stringify(links.slice(n, n + 500))));
    assert(statements.length <= 45, 413, "EVIDENCE_LIMIT", "证据关联过多，请缩小范围");
    statements.push(statement(ctx.db, "INSERT OR IGNORE INTO audit_events(id,business_id,actor_id,action,resource_id,created_at) VALUES(?,?,?,'snapshot_created',?,?)", `${id}:created`, ctx.businessId, ctx.userId, id, snap.generatedAt));
    assert(new TextEncoder().encode(JSON.stringify(snap)).length < 1900000, 413, "SNAPSHOT_SIZE", "快照过大，请缩小商品/渠道范围");
    await ctx.db.batch(statements);
    return JSON.parse((await first<{
        payload: string;
    }>(ctx.db, "SELECT payload FROM operating_snapshots WHERE id=?", id))!.payload) as Snapshot;
}
