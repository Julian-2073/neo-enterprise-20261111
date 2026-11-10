"use client";
// Snapshot scope controls + on-demand analysis runner for the /neo2 workspaces.
// Each analysis keeps its own input → process → output flow; nothing is cached across workspaces.

import {useCallback, useEffect, useState} from 'react';
import {useNeo2Session} from './session';
import {v2get, withBusiness, errorMessage} from './api';
import {Notice} from './ui';
import type {AnalysisResponse} from './types';

export type WorkspaceName = 'sales-change' | 'structure' | 'campaign';

/** Current + baseline snapshot selection, persisted per workspace in the session. */
export function useSnapshotScope() {
    const session = useNeo2Session();
    const {snapshots, setSnapshots} = session;
    const setCurrent = useCallback((id: string) => setSnapshots({current: id.trim() || null, baseline: snapshots.baseline}), [setSnapshots, snapshots.baseline]);
    const setBaseline = useCallback((id: string) => setSnapshots({current: snapshots.current, baseline: id.trim() || null}), [setSnapshots, snapshots.current]);
    return {current: snapshots.current, baseline: snapshots.baseline, setCurrent, setBaseline, ready: session.ready, businessId: session.businessId};
}

export function SnapshotsBar({baselineOptional = true}: {baselineOptional?: boolean}) {
    const {current, baseline, setCurrent, setBaseline} = useSnapshotScope();
    return (
        <form className="neo2-form" onSubmit={(e) => e.preventDefault()}>
            <label>
                当前快照 ID（snapshot_id）
                <input aria-label="当前快照 ID" value={current ?? ''} placeholder="导入确认后自动记录" onChange={(e) => setCurrent(e.target.value)} />
            </label>
            <label>
                基线快照 ID{baselineOptional ? '（可选）' : ''}
                <input aria-label="基线快照 ID" value={baseline ?? ''} placeholder="留空则无基准比较" onChange={(e) => setBaseline(e.target.value)} />
            </label>
            <small className="neo2-sr-hint">快照来自数据接入页确认入库；更换企业后自动清空。</small>
        </form>
    );
}

export type AnalysisState = {
    loading: boolean;
    error: string;
    data: AnalysisResponse | null;
    run: () => void;
};

/** On-demand analysis runner. Baseline param is only used by sales-change. */
export function useAnalysis(workspace: WorkspaceName): AnalysisState {
    const {businessId, current, baseline} = useSnapshotScope();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [data, setData] = useState<AnalysisResponse | null>(null);

    const run = useCallback(() => {
        if (!businessId || !current) return;
        const params = new URLSearchParams({snapshot_id: current});
        if (workspace === 'sales-change' && baseline) params.set('baseline_snapshot_id', baseline);
        let cancelled = false;
        setLoading(true);
        setError('');
        v2get<AnalysisResponse>(withBusiness(`/api/v2/store/analysis/${workspace}?${params.toString()}`, businessId))
            .then((d) => {
                if (!cancelled) setData(d);
            })
            .catch((e) => {
                if (!cancelled) {
                    setData(null);
                    setError(errorMessage(e));
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [businessId, current, baseline, workspace]);

    // Switching workspace scope or snapshot invalidates previous output (never shown for another scope).
    useEffect(() => {
        setData(null);
        setError('');
    }, [businessId, current, baseline, workspace]);

    return {loading, error, data, run};
}

export function EmptySnapshotHint({showImportLink = true}: {showImportLink?: boolean}) {
    return (
        <Notice tone="info">
            尚未选择当前快照。请先在数据接入页确认导入生成快照{showImportLink ? <>，或粘贴快照 ID</> : null}。
        </Notice>
    );
}
