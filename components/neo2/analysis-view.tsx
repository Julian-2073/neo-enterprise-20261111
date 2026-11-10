"use client";
// Shared analysis workspace view: independent input → process → output.
// The runner is explicit (button), output is a metric grid plus a full audit table.

import {useState} from 'react';
import {SnapshotsBar, EmptySnapshotHint, useAnalysis, type WorkspaceName} from './scope';
import {Card, MetricCard, EvidenceDrawer, EmptyState, Notice, AvailabilityBadge, type EvidenceSection} from './ui';
import {metricLabel, reasonText} from './labels';
import {formatMetricValue, formatMetricDenominator, formatDateTime} from './format';
import {useNeo2Session} from './session';
import type {MetricResult} from './types';

export function AnalysisWorkspaceView({workspace, notes}: {workspace: WorkspaceName; notes?: string[]}) {
    const analysis = useAnalysis(workspace);
    const session = useNeo2Session();
    const [evidence, setEvidence] = useState<MetricResult | null>(null);

    return (
        <>
            <Card title="输入：快照与基准">
                <SnapshotsBar />
                {!session.snapshots.current ? <EmptySnapshotHint /> : null}
                {notes?.map((note, index) => <p key={index} className="neo2-note">{note}</p>)}
                <div className="neo2-actions">
                    <button type="button" disabled={!session.snapshots.current || analysis.loading} onClick={analysis.run}>
                        {analysis.loading ? '计算中…' : '运行分析'}
                    </button>
                </div>
                <p className="neo2-sr-hint">分析在服务端以确定性函数运行，不使用大模型；每次运行生成独立的指标结果 ID。</p>
            </Card>
            {analysis.error ? <Notice tone="error">{analysis.error}</Notice> : null}
            {analysis.data ? (
                <OutputSection results={analysis.data.results} snapshotId={analysis.data.snapshot_id} onEvidence={setEvidence} />
            ) : !analysis.error && session.snapshots.current && !analysis.loading ? (
                <EmptyState title="尚未运行分析">点击「运行分析」生成结果。</EmptyState>
            ) : null}
            {evidence ? (
                <EvidenceDrawer
                    title="指标口径与证据"
                    sections={[{
                        title: metricLabel(evidence.metric_id),
                        meta: `口径：${evidence.metric_contract_version} · 范围哈希：${evidence.scope_hash} · 快照：${evidence.snapshot_id}`,
                        json: evidence,
                    }]}
                    onClose={() => setEvidence(null)}
                />
            ) : null}
        </>
    );
}

function OutputSection({results, snapshotId, onEvidence}: {
    results: MetricResult[];
    snapshotId: string;
    onEvidence: (result: MetricResult) => void;
}) {
    if (results.length === 0) {
        return <EmptyState title="分析完成但没有产出指标">快照缺少所需数据域时，服务端返回空结果集。</EmptyState>;
    }
    return (
        <>
            <Card title={`输出：结果概览（快照 ${snapshotId.slice(0, 8)}…）`}>
                <div className="neo2-metrics">
                    {results.map((result) => <MetricCard key={result.metric_result_id} result={result} onEvidence={onEvidence} />)}
                </div>
            </Card>
            <Card title="结果明细（含口径与证据）">
                <div className="neo2-table">
                    <table>
                        <thead>
                            <tr>
                                <th>指标</th>
                                <th>值</th>
                                <th>基线</th>
                                <th>可用性</th>
                                <th>证据</th>
                                <th>计算时间</th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.map((result) => (
                                <tr key={result.metric_result_id}>
                                    <td>{metricLabel(result.metric_id)}</td>
                                    <td><strong>{formatMetricValue(result)}</strong></td>
                                    <td>{formatMetricDenominator(result) ?? '—'}</td>
                                    <td><AvailabilityBadge availability={result.availability} /></td>
                                    <td>{result.evidence_ids.join('、') || '—'}</td>
                                    <td>{formatDateTime(result.calculated_at)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="neo2-note">
                    可用性说明：可用=全量数据可算；部分覆盖=部分输入缺失仍有结果；不可计算=缺少必要输入；不支持=当前数据粒度不产生该指标。
                    {results.some((r) => r.availability.reason_codes.length > 0) ? ' 原因码悬浮于徽章上。' : ''}
                </p>
            </Card>
        </>
    );
}

export {reasonText};
