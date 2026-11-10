"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Batch, DataNature, Kind } from "../../server/contracts";
import { templates } from "../../server/templates";
import "./workspace.css";
import { api, useWorkspace } from "./use-workspace";
type EvidenceResponse = {
    evidence: {
        id: string;
        title: string;
        formula: string;
        unit: string;
        value: unknown;
        sourceCount: number;
        limitations: string[];
    };
    records: Array<{
        id: string;
        row_number: number;
        payload: string;
        batch_id: string;
        source_name: string;
        filename: string;
    }>;
    nextCursor: number | null;
};
const money = (n: number | null) => n === null ? "待补数据" : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(n / 100);
const number = (n: number | null, unit: string) => n === null ? "待补数据" : `${n.toLocaleString("zh-CN")} ${unit}`;
const statuses: Record<string, string> = { validating: "校验中", ready: "可确认入库", invalid: "校验未通过", committed: "已入库", failed: "处理失败" };
type Workspace = ReturnType<typeof useWorkspace>;
function Shell({ w, active, children, locked = false }: {
    w: Workspace;
    active: string;
    children: ReactNode;
    locked?: boolean;
}) { return <div className="business-workspace"><header className="business-header"><a href={w.href("/")} className="business-logo">NEO</a><nav aria-label="经营导航">{[["home", "今日经营", "/"], ["people", "我的客户", "/analysis/people"], ["goods", "供应链与库存", "/analysis/goods"], ["market", "渠道与竞品", "/analysis/market"], ["imports", "数据导入", "/data/imports"]].map(([id, label, url]) => <a key={id} href={w.href(url)} aria-current={active === id ? "page" : undefined}>{label}</a>)}</nav><a href="/demo?mode=example">演示入口</a></header><main className="business-main"><div className="business-context"><label>企业<select aria-label="企业" disabled={locked || w.busy} value={w.business} onChange={e => w.setBusiness(e.target.value)}>{w.businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>资料来源<select aria-label="资料来源" disabled={locked || w.busy} value={w.nature} onChange={e => w.setNature(e.target.value as DataNature)}><option value="demo">验收样例</option><option value="business">业务导入 · 待业务核实</option></select></label><span>{!w.member ? "身份加载中" : w.member.role === "reader" ? "只读成员" : w.member?.role === "importer" ? "导入成员" : "管理员"}</span></div>{w.error && <div className="business-error" role="alert">{w.error}</div>}{children}</main><footer className="business-footer">数据来自已提交导入记录。来源覆盖与业务真实性需另行核实。<a href={w.href("/analysis/overview")}>预测与协同</a><a href={w.href("/reports/weekly")}>周报</a></footer></div>; }
function Scope({ w }: {
    w: Workspace;
}) { return <section className="business-card"><form className="business-scope" onSubmit={e => { e.preventDefault(); void w.publish().catch(() => { }); }}>{[["asOf", "截至日期"], ["periodStart", "统计起日"], ["periodEnd", "统计止日"], ["productId", "商品 ID"], ["channel", "渠道"]].map(([key, label]) => <label key={key}>{label}<input aria-label={label} type={["asOf", "periodStart", "periodEnd"].includes(key) ? "date" : "text"} value={w.range[key as keyof typeof w.range]} onChange={e => w.setRange(r => ({ ...r, [key]: e.target.value }))}/></label>)}<button disabled={w.busy || !w.business || w.member?.role === "reader"}>{w.busy ? "正在更新" : "生成 / 更新快照"}</button></form><p className="business-note">默认统计截至日期前的八个完整自然周；库存使用独立截至时点。所有页面读取同一快照。</p>{w.snapshot && <small>快照 {w.snapshot.id.slice(0, 17)} · {w.snapshot.periodStart} 至 {w.snapshot.periodEnd} · 截至 {w.snapshot.asOf} · Asia/Shanghai</small>}</section>; }
function Evidence({ id, w, onClose }: {
    id: string;
    w: Workspace;
    onClose: () => void;
}) {
    const [data, setData] = useState<EvidenceResponse | null>(null), [error, setError] = useState("");
    const dialog = useRef<HTMLDialogElement>(null);
    const params = w.params;
    const load = useCallback(async (cursor = 0) => { try {
        const d = await api<EvidenceResponse>(`/api/v1/evidence/${encodeURIComponent(id)}?${params()}&cursor=${cursor}`);
        setData(old => cursor && old ? { ...d, records: [...old.records, ...d.records] } : d);
    }
    catch (e) {
        setError((e as Error).message);
    } }, [id, params]);
    useEffect(() => {
      if(dialog.current&&!dialog.current.open)dialog.current.showModal();
      let cancelled=false;
      api<EvidenceResponse>(`/api/v1/evidence/${encodeURIComponent(id)}?${params()}`).then(d=>{if(!cancelled)setData(d);}).catch(e=>{if(!cancelled)setError(e.message);});
      return ()=>{cancelled=true;};
    }, [id,params]);
    return <dialog ref={dialog} className="business-dialog" aria-label="经营证据" onCancel={onClose} onClose={onClose}><button className="business-close" onClick={() => dialog.current?.close()}>关闭</button>{error && <p role="alert">{error}</p>}{data && <><h2>{data.evidence.title}</h2><p>{data.evidence.formula}</p><p>单位：{data.evidence.unit} · 来源记录 {data.evidence.sourceCount} 条</p><pre>{JSON.stringify(data.evidence.value, null, 2)}</pre>{data.records.map(r => <section key={r.id} className="business-evidence-row"><strong>{r.source_name} · {r.filename} · 第 {r.row_number} 条 CSV 记录</strong><pre>{JSON.stringify(JSON.parse(r.payload), null, 2)}</pre><a href={`/api/v1/ingestion-batches/${r.batch_id}/file?${w.params()}`}>下载原文件</a></section>)}{data.nextCursor !== null && <button onClick={() => void load(data.nextCursor!)}>加载更多来源</button>}<p className="business-note">CSV 行号按表头及逻辑记录计数，含换行的单元格仍是一条记录。</p></>}</dialog>;
}
function Metrics({ w, onEvidence }: {
    w: Workspace;
    onEvidence: (id: string) => void;
}) { const s = w.snapshot!; return <div className="business-metrics">{Object.entries(s.data.financial).map(([key, value]) => <button key={key} className="business-card business-metric" onClick={() => onEvidence(s.evidenceIds[key])}><span>{({ paidOrders: "支付订单数", netRevenueCents: "净成交额", spendCents: "投放费用", variableCostCents: "变动成本", contributionMarginCents: "贡献毛利" } as Record<string, string>)[key]}</span><strong>{key === "paidOrders" ? number(value, "笔") : money(value)}</strong><small>查看口径与来源</small></button>)}</div>; }
function Events({ w, onEvidence }: {
    w: Workspace;
    onEvidence: (id: string) => void;
}) { return <section className="business-card"><h2>行为事件量</h2><div className="business-metrics">{Object.entries(w.snapshot!.data.events).map(([key, value]) => <button className="business-metric" key={key} onClick={() => onEvidence(w.snapshot!.evidenceIds[key])}><span>{key}</span><strong>{number(value, "次")}</strong></button>)}</div><p className="business-note">按事件数量汇总，不是去重客户人数；支付订单单独统计。</p></section>; }
function Trend({ w, onEvidence }: {
    w: Workspace;
    onEvidence: (id: string) => void;
}) { const s = w.snapshot!; return <section className="business-card"><h2>行为与订单周度趋势</h2><div className="business-table"><table><thead><tr><th>日期</th><th>A1 次</th><th>A2 次</th><th>A3 次</th><th>支付订单 笔</th><th>净成交额</th></tr></thead><tbody>{s.data.weeks.map(p => <tr key={p.start}><td><button className="business-link" onClick={() => onEvidence(s.evidenceIds[`week:${p.start}`])}>{p.start} — {p.end}</button></td>{["A1", "A2", "A3"].map(k => <td key={k}>{number(p.events[k], "")}</td>)}<td>{number(p.paidOrders, "")}</td><td>{money(p.netRevenueCents)}</td></tr>)}</tbody></table></div></section>; }
function Inventory({ w, onEvidence }: {
    w: Workspace;
    onEvidence: (id: string) => void;
}) { const rows = w.snapshot!.data.inventory; return <section className="business-card"><h2>已导入库存 · 截至 {w.snapshot!.asOf}</h2>{!rows.length ? <p>库存待接入</p> : <><p>已导入 {rows.length} 处仓库与商品规格库存记录；可售 {rows.reduce((s, r) => s + BigInt(r.sellable_units ?? 0), BigInt(0)).toLocaleString("zh-CN")} 件。覆盖范围以来源为准。</p><div className="business-table"><table><thead><tr><th>商品 / 商品规格</th><th>仓库</th><th>可售</th><th>在途</th><th>已设定备货目标（需核对）</th><th>库存成本</th><th>来源时点</th></tr></thead><tbody>{rows.map(r => <tr key={r.factId}><td><button className="business-link" onClick={() => onEvidence(r.evidenceId)}>{r.product_id} / {r.sku_id}</button></td><td>{r.warehouse_id}</td><td>{number(r.sellable_units ?? null, "件")}</td><td>{number(r.in_transit_units ?? null, "件")}</td><td>{number(r.safety_units ?? null, "件")}</td><td>{money(r.inventory_cost_cents ?? null)}</td><td>{r.business_date}</td></tr>)}</tbody></table></div></>}</section>; }
function Channels({ w, onEvidence }: {
    w: Workspace;
    onEvidence: (id: string) => void;
}) { return <section className="business-card"><h2>渠道经营与费用</h2><div className="business-table"><table><thead><tr><th>渠道</th><th>支付订单</th><th>净成交额</th><th>投放费用</th></tr></thead><tbody>{w.snapshot!.data.channels.map(c => <tr key={c.channel}><td><button className="business-link" onClick={() => onEvidence(c.evidenceId)}>{c.channel}</button></td><td>{number(c.paidOrders, "笔")}</td><td>{money(c.netRevenueCents)}</td><td>{money(c.spendCents)}</td></tr>)}</tbody></table></div><p className="business-note">竞品、政策与市场机会待接入。</p></section>; }
export function BusinessPage({ page }: {
    page: "home" | "people" | "goods" | "market" | "overview" | "weekly";
}) {
    const w = useWorkspace();
    const [evidence, setEvidence] = useState<{ id: string; snapshotId: string } | null>(null), [brief, setBrief] = useState(page === "home");
    const titles = { home: "今日经营", people: "我的客户", goods: "供应链与库存", market: "渠道与竞品", overview: "预测与协同待接入", weekly: "行动与周报待接入" };
    const onEvidence = (id: string) => { if (w.snapshot) setEvidence({ id, snapshotId: w.snapshot.id }); };
    return <Shell w={w} active={page}><h1>{titles[page]}</h1><Scope w={w}/>{["overview", "weekly"].includes(page) ? <section className="business-card"><p>本轮完成数据导入与经营证据；该功能尚未接入业务数据。</p></section> : !w.snapshot ? <section className="business-card"><h2>尚无经营快照</h2><p>先导入并确认数据，再生成快照。缺失数据不会自动补成演示值。</p><a href={w.href("/data/imports")}>进入数据导入</a></section> : <>{page === "home" && <button onClick={() => setBrief(true)}>打开今日经营简报</button>}{["home", "people"].includes(page) && <Metrics w={w} onEvidence={onEvidence}/>} {["home", "people"].includes(page) && <Events w={w} onEvidence={onEvidence}/>} {page === "people" && <Trend w={w} onEvidence={onEvidence}/>} {["home", "goods"].includes(page) && <Inventory w={w} onEvidence={onEvidence}/>} {["home", "market"].includes(page) && <Channels w={w} onEvidence={onEvidence}/>}<section className="business-card business-notes"><h2>数据范围与限制</h2>{w.snapshot.limitations.map(item => <p key={item}>{item}</p>)}<p>{w.nature === "demo" ? "验收样例，不用于真实经营决策。" : "业务导入数据尚待业务核实。"}</p></section></>}{evidence && evidence.snapshotId === w.snapshot?.id && <Evidence id={evidence.id} w={w} onClose={() => setEvidence(null)}/>} {brief && <Brief w={w} onClose={() => setBrief(false)}/>}</Shell>;
}
function Brief({ w, onClose }: {
    w: Workspace;
    onClose: () => void;
}) { const ref = useRef<HTMLDialogElement>(null); useEffect(() => { ref.current?.showModal(); }, []); return <dialog ref={ref} className="business-dialog" aria-label="今日经营简报" onCancel={onClose} onClose={onClose}><button className="business-close" onClick={() => ref.current?.close()}>关闭</button><h2>今日经营简报</h2><p>{w.member?.name || "经营数据"}</p>{w.snapshot ? <><p>{w.snapshot.periodStart} 至 {w.snapshot.periodEnd} · 截至 {w.snapshot.asOf}</p><p>支付订单：{number(w.snapshot.data.financial.paidOrders, "笔")}；净成交额：{money(w.snapshot.data.financial.netRevenueCents)}。</p><p>投放费用：{money(w.snapshot.data.financial.spendCents)}；贡献毛利：{money(w.snapshot.data.financial.contributionMarginCents)}。</p></> : <p>尚无经营快照，请先导入数据。</p>}<p>政策、预测和市场机会待接入。</p></dialog>; }
export function ImportPage() {
    const w = useWorkspace();
    return <ImportPanel w={w} key={`${w.business}:${w.nature}`}/>;
}
function ImportPanel({w}:{w:Workspace}) {
    const {business,params,setError}=w;
    const [kind, setKind] = useState<Kind>("events"), [source, setSource] = useState(""), [coverage, setCoverage] = useState({ start: "", end: "" }), [file, setFile] = useState<File | null>(null), [batch, setBatch] = useState<Batch | null>(null), [history, setHistory] = useState<Batch[]>([]), [historyCursor, setHistoryCursor] = useState<number | null>(null), [issues, setIssues] = useState<Array<{
        row_number: number;
        field: string;
        message: string;
    }>>([]), [rows, setRows] = useState<Array<{
        row_number: number;
        payload: string;
        duplicate: number;
    }>>([]), [rowCursor, setRowCursor] = useState<number | null>(null), [issueCursor, setIssueCursor] = useState<number | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
    const readonly = w.member?.role === "reader";
    const loadHistory = useCallback(async (cursor = 0) => { if (!business)
        return; const d = await api<{
        items: Batch[];
        nextCursor: number | null;
    }>(`/api/v1/ingestion-batches?${params()}&cursor=${cursor}`); setHistory(old => cursor ? [...old, ...d.items] : d.items); setHistoryCursor(d.nextCursor); }, [business, params]);
    const selectBatch = async (b: Batch) => { setBatch(b); setRows([]); setIssues([]); setNotice(""); const [d, i] = await Promise.all([api<{
            rows: typeof rows;
            nextCursor: number | null;
        }>(`/api/v1/ingestion-batches/${b.id}?${w.params()}`), api<{
            items: typeof issues;
            nextCursor: number | null;
        }>(`/api/v1/ingestion-batches/${b.id}/issues?${w.params()}`)]); setRows(d.rows); setRowCursor(d.nextCursor); setIssues(i.items); setIssueCursor(i.nextCursor); };
    useEffect(() => {
      if(!business)return;
      let cancelled=false;
      api<{items:Batch[];nextCursor:number|null}>(`/api/v1/ingestion-batches?${params()}`).then(d=>{if(!cancelled){setHistory(d.items);setHistoryCursor(d.nextCursor);}}).catch(e=>{if(!cancelled)setError(e.message);});
      return ()=>{cancelled=true;};
    }, [business,params,setError]);
    const upload = async (selected = file, sample = false) => { if (!selected)
        return; setBusy(true); setNotice(""); w.setError(""); try {
        const form = new FormData();
        form.set("file", selected);
        form.set("kind", kind);
        form.set("templateVersion", "1");
        form.set("sourceName", sample ? "NEO 本地验收样例" : source);
        form.set("dataNature", sample ? "demo" : w.nature);
        form.set("coverageStart", sample ? "2026-09-01" : coverage.start);
        form.set("coverageEnd", sample ? "2026-09-02" : coverage.end);
        const d = await api<{
            batch: Batch;
            reused: boolean;
        }>(`/api/v1/ingestion-batches?${w.params()}`, { method: "POST", body: form });
        await selectBatch(d.batch);
        await loadHistory();
        if (sample) {
            setSource("NEO 本地验收样例");
            setCoverage({ start: "2026-09-01", end: "2026-09-02" });
        }
        if (d.reused)
            setNotice("已回读同一文件的已有批次，未重复创建。");
    }
    catch (e) {
        w.setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } };
    const commit = async () => { if (!batch)
        return; setBusy(true); w.setError(""); setNotice(""); try {
        let latest: Batch;
        try {
            latest = (await api<{
                batch: Batch;
            }>(`/api/v1/ingestion-batches/${batch.id}/commit?${w.params()}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ validationVersion: batch.validation_version }) })).batch;
        }
        catch (e) {
            const readback = await api<{
                batch: Batch;
            }>(`/api/v1/ingestion-batches/${batch.id}?${w.params()}`);
            if (readback.batch.status !== "committed")
                throw e;
            latest = readback.batch;
        }
        setBatch(latest);
        await loadHistory();
        try {
            await w.publish(latest.data_nature === "demo" && source === "NEO 本地验收样例" ? { dataNature: "demo", asOf: "2026-09-02", periodStart: "2026-09-01", periodEnd: "2026-09-02" } : { dataNature: latest.data_nature });
            setNotice(`已入库 ${latest.imported_count} 条，重复 ${latest.duplicate_count} 条；快照已更新。`);
        }
        catch {
            setNotice("数据已入库，看板更新失败。可单独重试快照，勿重新导入。");
        }
    }
    catch (e) {
        w.setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } };
    return <Shell w={w} active="imports" locked={busy}><h1>数据导入</h1><p><a href={w.href("/data/ontology")}>进入 Ontology 后端工作台</a></p><p>先校验预览，再确认入库。每文件最多 1,000 条、1 MiB；仅接收 UTF-8 标准 CSV。</p><section className="business-card"><form className="business-import-form" onSubmit={e => { e.preventDefault(); void upload(); }}><label>模板<select aria-label="模板" value={kind} onChange={e => setKind(e.target.value as Kind)}>{Object.entries(templates).map(([id, t]) => <option key={id} value={id}>{t.name}</option>)}</select></label><label>来源名称<input aria-label="来源名称" required maxLength={200} value={source} onChange={e => setSource(e.target.value)} placeholder="如：抖音店铺月度导出"/></label><label>覆盖起日<input aria-label="覆盖起日" type="date" required value={coverage.start} onChange={e => setCoverage(c => ({ ...c, start: e.target.value }))}/></label><label>覆盖止日<input aria-label="覆盖止日" type="date" required value={coverage.end} onChange={e => setCoverage(c => ({ ...c, end: e.target.value }))}/></label><label>CSV 文件<input aria-label="CSV 文件" type="file" accept=".csv" required onChange={e => setFile(e.target.files?.[0] || null)}/></label><button disabled={busy || !w.business || readonly}>{busy ? "处理中" : "上传并校验"}</button></form><p>{templates[kind].notes}</p><div className="business-actions"><a href={`/api/v1/import-templates/${kind}?${w.params()}&format=csv`}>下载标准模板</a><a href={`/import-samples/demo-${kind}.csv`}>下载隔离验收样例</a>{w.nature === "demo" && <button disabled={busy || !w.business || readonly} onClick={async () => { try {
        const r = await fetch(`/import-samples/demo-${kind}.csv`);
        await upload(new File([await r.blob()], `demo-${kind}.csv`, { type: "text/csv" }), true);
    }
    catch (e) {
        w.setError((e as Error).message);
    } }}>校验此模板的验收样例</button>}</div><p className="business-note">覆盖日期由数据提供者声明。相同来源名称应持续复用，订单退款须使用原订单来源。</p></section>{notice && <p role="status" className="business-success">{notice}</p>}{batch && <section className="business-card"><h2>批次预览：{batch.filename}</h2><p>{statuses[batch.status]} · {batch.row_count} 条 · 重复 {batch.duplicate_count} 条 · 校验版本 {batch.validation_version}</p>{batch.error && <p>{batch.error}</p>}<div className="business-actions"><button disabled={busy || readonly || batch.status !== "ready"} onClick={() => void commit()}>确认入库并更新看板</button><a href={`/api/v1/ingestion-batches/${batch.id}/file?${w.params()}`}>下载原文件</a><a href={`/api/v1/ingestion-batches/${batch.id}/issues?${w.params()}&format=csv`}>下载错误报告</a><a href={w.href("/")}>查看经营看板</a></div>{issues.length > 0 && <><h3>校验问题</h3><ul>{issues.map((i, n) => <li key={n}>第 {i.row_number} 条 · {i.field}：{i.message}</li>)}</ul>{issueCursor !== null && <button onClick={async () => { const d = await api<{
        items: typeof issues;
        nextCursor: number | null;
    }>(`/api/v1/ingestion-batches/${batch.id}/issues?${w.params()}&cursor=${issueCursor}`); setIssues(old => [...old, ...d.items]); setIssueCursor(d.nextCursor); }}>加载更多问题</button>}</>}<h3>有效记录预览</h3><p className="business-note">存在错误时，下面的有效行也不会被部分入库。</p>{rows.map(r => <details key={r.row_number}><summary>第 {r.row_number} 条{r.duplicate ? " · 重复记录" : ""}</summary><pre>{JSON.stringify(JSON.parse(r.payload), null, 2)}</pre></details>)}{rowCursor !== null && <button onClick={async () => { const d = await api<{
        rows: typeof rows;
        nextCursor: number | null;
    }>(`/api/v1/ingestion-batches/${batch.id}?${w.params()}&cursor=${rowCursor}`); setRows(old => [...old, ...d.rows]); setRowCursor(d.nextCursor); }}>加载更多记录</button>}</section>}<Scope w={w}/><section className="business-card"><h2>导入历史</h2>{history.length === 0 ? <p>暂无批次</p> : <div className="business-table"><table><thead><tr><th>文件</th><th>性质</th><th>类型</th><th>状态</th><th>新增</th><th>重复</th></tr></thead><tbody>{history.map(b => <tr key={b.id}><td><button className="business-link" onClick={() => void selectBatch(b).catch(e => w.setError(e.message))}>{b.filename}</button></td><td>{b.data_nature === "demo" ? "验收样例" : "业务导入"}</td><td>{templates[b.kind]?.name}</td><td>{statuses[b.status]}</td><td>{b.imported_count}</td><td>{b.duplicate_count}</td></tr>)}</tbody></table></div>}{historyCursor !== null && <button onClick={() => void loadHistory(historyCursor).catch(e => w.setError(e.message))}>加载更多批次</button>}</section></Shell>;
}
