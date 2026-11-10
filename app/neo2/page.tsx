"use client";
// 今日经营 (H01): 能力覆盖 → 指标层（变化口径，来自服务端计算）→ 今日优先事项 → 昨日事项跟进。

import {useEffect, useState} from 'react';
import {Neo2Shell} from '../../components/neo2/shell';
import {useNeo2Session} from '../../components/neo2/session';
import {SnapshotsBar, EmptySnapshotHint, useAnalysis} from '../../components/neo2/scope';
import {Card, MetricCard, EvidenceDrawer, EmptyState, Notice, type EvidenceSection} from '../../components/neo2/ui';
import {CaseCard} from '../../components/neo2/case-view';
import {v2get, withBusiness, errorMessage} from '../../components/neo2/api';
import {metricLabel} from '../../components/neo2/labels';
import type {CaseRow, MetricResult} from '../../components/neo2/types';

export default function Page() {
    return (
        <Neo2Shell active="home" title="今日经营" subtitle="今天先处理什么：优先事项来自服务端排序，指标为已确认快照的变化口径。">
            <WorkspaceBody />
        </Neo2Shell>
    );
}

function WorkspaceBody() {
    const session = useNeo2Session();
    const metrics = useAnalysis('sales-change');

    // 指标层：选中快照后自动运行一次销售变化分析（run 的身份随作用域变化而更新）。
    useEffect(() => {
        metrics.run();
    }, [metrics.run]);

    return (
        <>
            <SnapshotsBar />
            {!session.snapshots.current ? <EmptySnapshotHint /> : null}
            {session.capabilities ? <CoverageCard /> : null}
            <MetricsSection metrics={metrics} />
            <PrioritiesSection />
            <FollowupSection />
        </>
    );
}

function CoverageCard() {
    const session = useNeo2Session();
    const capabilities = session.capabilities;
    if (!capabilities) return null;
    const limitations = capabilities.warnings ?? [];
    return (
        <Card title="能力与数据覆盖">
            {limitations.length > 0 ? (
                <ul className="neo2-list">
                    {limitations.map((text, index) => <li key={index}>{text}</li>)}
                </ul>
            ) : (
                <p className="neo2-note">当前角色与数据覆盖下全部能力可用。</p>
            )}
            <p className="neo2-sr-hint">能力口径生成于 {new Date(capabilities.generated_at).toLocaleString('zh-CN', {hour12: false})}</p>
        </Card>
    );
}

function MetricsSection({metrics}: {metrics: ReturnType<typeof useAnalysis>}) {
    const [evidence, setEvidence] = useState<MetricResult | null>(null);
    if (!metrics.data && !metrics.error && !metrics.loading) return null;
    if (metrics.loading) return <Card title="指标层"><p className="neo2-note">正在计算…</p></Card>;
    if (metrics.error) return <Card title="指标层"><Notice tone="error">{metrics.error}</Notice></Card>;
    if (!metrics.data) return null;
    const results = metrics.data.results;
    const sections: EvidenceSection[] = [{
        title: metricLabel(evidence?.metric_id ?? ''),
        meta: `口径：${evidence?.metric_contract_version ?? ''} · 范围哈希：${evidence?.scope_hash ?? ''}`,
        json: evidence,
    }];
    return (
        <Card title={`指标层（快照 ${metrics.data.snapshot_id.slice(0, 8)}…）`}>
            <div className="neo2-metrics">
                {results.map((result) => (
                    <MetricCard key={result.metric_result_id} result={result} onEvidence={(r) => setEvidence(r)} />
                ))}
            </div>
            <p className="neo2-note">订单级指标在 day_sku 粒度不可计算，显示为「不支持」而非 0。</p>
            {evidence ? <EvidenceDrawer title="指标口径与证据" sections={sections} onClose={() => setEvidence(null)} /> : null}
        </Card>
    );
}

function PrioritiesSection() {
    const session = useNeo2Session();
    const [state, setState] = useState<'loading' | 'error' | 'done'>('loading');
    const [error, setError] = useState('');
    const [cases, setCases] = useState<CaseRow[]>([]);

    useEffect(() => {
        if (!session.businessId) return;
        let cancelled = false;
        setState('loading');
        v2get<{cases: CaseRow[]}>(withBusiness('/api/v2/store/cases?limit=3', session.businessId))
            .then((d) => {
                if (cancelled) return;
                setCases(d.cases ?? []);
                setState('done');
            })
            .catch((e) => {
                if (cancelled) return;
                setError(errorMessage(e));
                setState('error');
            });
        return () => {
            cancelled = true;
        };
    }, [session.businessId]);

    return (
        <Card
            title="今日优先事项"
            actions={<a className="neo2-link" href={withBusiness('/neo2/actions', session.businessId)}>进入行动中心</a>}
        >
            {state === 'loading' ? <p className="neo2-note">正在读取…</p> : null}
            {state === 'error' ? <Notice tone="error">{error}</Notice> : null}
            {state === 'done' && cases.length === 0 ? (
                <EmptyState title="今天没有待处理事件">
                    新事件由数据接入页的「检测缺码信号」或后续导入触发。
                </EmptyState>
            ) : null}
            {cases.length > 0 ? (
                <ul className="neo2-list">
                    {cases.map((caseRow) => <CaseCard key={caseRow.case_id} caseRow={caseRow} businessId={session.businessId} />)}
                </ul>
            ) : null}
        </Card>
    );
}

function FollowupSection() {
    const session = useNeo2Session();
    const [observing, setObserving] = useState<CaseRow[]>([]);
    const [reviewed, setReviewed] = useState<CaseRow[]>([]);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!session.businessId) return;
        let cancelled = false;
        const load = async () => {
            try {
                const [observingRes, reviewedRes] = await Promise.all([
                    v2get<{cases: CaseRow[]}>(withBusiness('/api/v2/store/cases?state=observing', session.businessId)),
                    v2get<{cases: CaseRow[]}>(withBusiness('/api/v2/store/cases?state=reviewed', session.businessId)),
                ]);
                if (cancelled) return;
                setObserving(observingRes.cases ?? []);
                setReviewed(reviewedRes.cases ?? []);
                setError('');
            } catch (e) {
                if (!cancelled) setError(errorMessage(e));
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [session.businessId]);

    const href = (id: string) => withBusiness(`/neo2/cases?case_id=${encodeURIComponent(id)}`, session.businessId);
    return (
        <Card title="等待观察与昨日交接">
            {error ? <Notice tone="error">{error}</Notice> : null}
            <h3>等待观察（{observing.length}）</h3>
            {observing.length === 0 ? <p className="neo2-note">没有处于观察期的事件。</p> : (
                <ul className="neo2-list">
                    {observing.map((caseRow) => (
                        <li key={caseRow.case_id}>
                            <strong>{caseRow.title}</strong>
                            <p className="neo2-item-meta">更新于 {new Date(caseRow.updated_at).toLocaleString('zh-CN', {hour12: false})}</p>
                            <a className="neo2-link" href={href(caseRow.case_id)}>查看观察口径与证据</a>
                        </li>
                    ))}
                </ul>
            )}
            <h3>已复盘待交接（{reviewed.length}）</h3>
            {reviewed.length === 0 ? <p className="neo2-note">没有待交接事件。</p> : (
                <ul className="neo2-list">
                    {reviewed.map((caseRow) => (
                        <li key={caseRow.case_id}>
                            <strong>{caseRow.title}</strong>
                            <p className="neo2-item-meta">更新于 {new Date(caseRow.updated_at).toLocaleString('zh-CN', {hour12: false})}</p>
                            <a className="neo2-link" href={href(caseRow.case_id)}>查看复盘结论</a>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}
