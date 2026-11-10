import { useCallback, useEffect, useRef, useState } from "react";
import type { DataNature, Snapshot } from "../../server/contracts.ts";

type Member = { id: string; name: string; role: string };
type Scope = { businessId: string; dataNature: DataNature; snapshotId: string | null };
type Range = { asOf: string; periodStart: string; periodEnd: string; productId: string; channel: string };
const emptyRange = (): Range => ({ asOf: "", periodStart: "", periodEnd: "", productId: "", channel: "" });
const snapshotRange = (s: Snapshot): Range => ({ asOf: s.asOf, periodStart: s.periodStart, periodEnd: s.periodEnd, productId: s.productId || "", channel: s.channel || "" });

const pendingReads = new Map<string, Promise<unknown>>();
async function requestData(path: string, options?: RequestInit): Promise<unknown> {
    const read = (options?.method ?? 'GET').toUpperCase() === 'GET';
    for (let attempt = 0; ; attempt++) {
        let response: Response;
        try { response = await fetch(path, { cache: 'no-store', ...options }); }
        catch (error) {
            if (!read || attempt || !(error instanceof TypeError) || options?.signal?.aborted) throw error;
            await new Promise(resolve => setTimeout(resolve, 100));
            continue;
        }
        const data = await response.json();
        if (response.ok) return data;
        if (read && !attempt && response.status === 503 && !options?.signal?.aborted) {
            await new Promise(resolve => setTimeout(resolve, 100));
            continue;
        }
        throw new Error(data.error?.message || '请求失败');
    }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
    // Share only concurrent default reads, never writes, caller headers or abort signals.
    if (options || path.endsWith('/businesses/current')) return await requestData(path, options) as T;
    let pending = pendingReads.get(path);
    if (!pending) {
        pending = requestData(path);
        pendingReads.set(path, pending);
        void pending.then(() => pendingReads.delete(path), () => pendingReads.delete(path));
    }
    return structuredClone(await pending) as T;
}
export async function automaticAnalysisAllowed(query: URLSearchParams | string): Promise<boolean> {
    const policy = await api<{ automaticPatrolAllowed: boolean }>(`/api/v1/agent-policy?${query}`);
    return policy.automaticPatrolAllowed === true;
}
function readScope(defaultBusiness: string): Scope {
    const q = new URLSearchParams(window.location.search);
    return { businessId: q.get("businessId") || defaultBusiness, dataNature: q.get("dataNature") === "business" ? "business" : "demo", snapshotId: q.get("snapshotId") || q.get("generationId") || null };
}
function scopeParams(scope: Scope) {
    const q = new URLSearchParams({ businessId: scope.businessId, dataNature: scope.dataNature });
    if (scope.snapshotId) q.set("snapshotId", scope.snapshotId);
    return q;
}
function writeScope(scope: Scope, mode: "push" | "replace") {
    const url = new URL(window.location.href);
    if(url.searchParams.get('snapshotId')!==scope.snapshotId||url.searchParams.get('businessId')!==scope.businessId||url.searchParams.get('dataNature')!==scope.dataNature)for(const key of ['baselineId','scenarioId','proposalRunId','reviewRunId'])url.searchParams.delete(key);
    url.searchParams.delete("generationId");
    url.searchParams.set("businessId", scope.businessId);
    url.searchParams.set("dataNature", scope.dataNature);
    if (scope.snapshotId) url.searchParams.set("snapshotId", scope.snapshotId);
    else url.searchParams.delete("snapshotId");
    if (url.href !== window.location.href) {
        // Preserve framework history state; only change this page's query scope.
        window.history[mode === "push" ? "pushState" : "replaceState"](window.history.state, "", url.href);
    }
}

export function useWorkspace() {
    const [businesses, setBusinesses] = useState<Member[]>([]);
    const [scope, setScope] = useState<Scope>({ businessId: "", dataNature: "demo", snapshotId: null });
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState<Range>(emptyRange);
    const sequence = useRef(0);
    const currentScope = useRef(scope);
    const defaultBusiness = useRef("");

    const restore = useCallback(async (next: Scope, mode: "push" | "replace") => {
        const seq = ++sequence.current;
        currentScope.current = next;
        setScope(next); setSnapshot(null); setRange(emptyRange()); setError(""); setBusy(false); setLoading(true);
        writeScope(next, mode);
        try {
            const d = await api<{ snapshot: Snapshot | null }>(`/api/v1/operating-snapshot?${scopeParams(next)}`);
            if (seq !== sequence.current) return;
            if (d.snapshot && (d.snapshot.businessId !== next.businessId || d.snapshot.dataNature !== next.dataNature || next.snapshotId && d.snapshot.id !== next.snapshotId)) {
                throw new Error("快照与当前企业、数据性质或历史版本不一致");
            }
            // An explicit historical ID is never replaced with the latest snapshot.
            const resolved = { ...next, snapshotId: !next.snapshotId&&d.snapshot?.operating?null:d.snapshot?.id ?? next.snapshotId };
            writeScope(resolved, "replace");
            currentScope.current = resolved;
            setScope(resolved); setSnapshot(d.snapshot); setRange(d.snapshot ? snapshotRange(d.snapshot) : emptyRange());
        } catch (e) {
            if (seq === sequence.current) setError((e as Error).message);
        } finally {
            if (seq === sequence.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        let disposed = false;
        const invalidateRequests = () => { sequence.current++; };
        const onPopState = () => {
            if (defaultBusiness.current) void restore(readScope(defaultBusiness.current), "replace");
        };
        window.addEventListener("popstate", onPopState);
        api<{ businesses: Member[]; current: Member }>("/api/v1/businesses/current").then(d => {
            if (disposed) return;
            setBusinesses(d.businesses); defaultBusiness.current = d.current.id;
            // Read at response time so navigation during identity loading is respected.
            void restore(readScope(d.current.id), "replace");
        }).catch(e => { if (!disposed) { setError(e.message); setLoading(false); } });
        return () => { disposed = true; invalidateRequests(); window.removeEventListener("popstate", onPopState); };
    }, [restore]);

    useEffect(()=>{
        if(!snapshot?.operating||scope.snapshotId)return;let disposed=false,reading=false;
        const refresh=async()=>{if(reading||disposed||document.visibilityState==='hidden')return;reading=true;const current=currentScope.current,seq=sequence.current;try{const d=await api<{snapshot:Snapshot|null}>(`/api/v1/operating-snapshot?${scopeParams(current)}`);if(!disposed&&seq===sequence.current&&!currentScope.current.snapshotId&&d.snapshot&&d.snapshot.businessId===current.businessId&&d.snapshot.dataNature===current.dataNature&&d.snapshot.id!==snapshot.id){setSnapshot(d.snapshot);setRange(snapshotRange(d.snapshot));const url=new URL(window.location.href);for(const key of ['baselineId','scenarioId','proposalRunId','reviewRunId'])url.searchParams.delete(key);window.history.replaceState(window.history.state,'',url);}}catch(e){if(!disposed)setError((e as Error).message);}finally{reading=false;}};
        const timer=setInterval(()=>void refresh(),30000);window.addEventListener('neo:data',refresh);return()=>{disposed=true;clearInterval(timer);window.removeEventListener('neo:data',refresh);};
    },[snapshot,scope.snapshotId]);

    const params = useCallback(() => new URLSearchParams({ businessId: scope.businessId, dataNature: scope.dataNature }), [scope.businessId, scope.dataNature]);
    const chooseBusiness = (id: string) => {
        const current = currentScope.current;
        if (id !== current.businessId) void restore({ businessId: id, dataNature: current.dataNature, snapshotId: null }, "push");
    };
    const chooseNature = (value: DataNature) => {
        const current = currentScope.current;
        if (value !== current.dataNature) void restore({ businessId: current.businessId, dataNature: value, snapshotId: null }, "push");
    };
    const publish = async (overrides?: Record<string, string>) => {
        const current = currentScope.current;
        // Async import callbacks may still hold a render from a previous enterprise.
        if (scope.businessId !== current.businessId || scope.dataNature !== current.dataNature) throw new Error("企业或数据性质已切换，请在对应范围更新快照");
        const seq = ++sequence.current;
        setBusy(true); setError("");
        try {
            const dates = ['asOf', 'periodStart', 'periodEnd'] as const;
            const fullHistory = snapshot?.periodMode === 'all_imported' && dates.every(key => range[key] === snapshot[key] && !overrides?.[key]);
            const input = { dataNature: current.dataNature, ...(snapshot?.data.materials?.customerAnalysis.rule?{customerFunnel:snapshot.data.materials.customerAnalysis.rule}:{}), ...Object.fromEntries(Object.entries(range).filter(([key, v]) => v && !(fullHistory && dates.includes(key as typeof dates[number])))), ...(fullHistory?{periodMode:'all_imported'}:{}), ...overrides };
            const d = await api<{ snapshot: Snapshot }>(`/api/v1/operating-snapshots?${scopeParams(current)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
            if (seq !== sequence.current) throw new Error("页面范围已改变，已生成快照可在原范围回读");
            if (d.snapshot.businessId !== current.businessId || d.snapshot.dataNature !== current.dataNature) throw new Error("生成的快照与当前范围不一致");
            const resolved = { ...current, snapshotId: d.snapshot.id };
            writeScope(resolved, "push");
            currentScope.current = resolved;
            setScope(resolved); setSnapshot(d.snapshot); setRange(snapshotRange(d.snapshot));
            return d.snapshot;
        } catch (e) {
            if (seq === sequence.current) setError((e as Error).message);
            throw e;
        } finally {
            if (seq === sequence.current) setBusy(false);
        }
    };
    const href = (path: string) => {
        const url = new URL(path, "http://neo.local");
        for (const [key, value] of scopeParams(scope)) url.searchParams.set(key, value);
        if (!scope.snapshotId) url.searchParams.delete("snapshotId");
        return `${url.pathname}${url.search}${url.hash}`;
    };
    const member = businesses.find(b => b.id === scope.businessId);
    const selectSnapshot=(id:string|null)=>void restore({...currentScope.current,snapshotId:id},'push');
    const retrySnapshot=()=>void restore(currentScope.current,'replace');
    return { businesses, business: scope.businessId, setBusiness: chooseBusiness, nature: scope.dataNature, setNature: chooseNature, snapshot, selectSnapshot,retrySnapshot,loading,error, setError, busy, range, setRange, publish, params, href, member };
}
