"use client";
// Shared presentation components for /neo2.
// Unknown data renders as 缺数据 with reasons; availability uses the four-status enum.

import {useEffect, useRef, useState, type ReactNode} from 'react';
import {reasonText, CASE_STATE_ZH, PLAN_STATE_ZH, TASK_STATE_ZH, metricLabel} from './labels';
import {formatMetricValue, formatMetricDenominator, formatDateTime} from './format';
import type {Availability, MetricResult} from './types';
import './neo2.css';

const AVAILABILITY_ZH: Record<Availability['status'], string> = {
    available: '可用',
    partial: '部分覆盖',
    blocked: '不可计算',
    not_supported: '不支持',
};

export function AvailabilityBadge({availability}: {availability: Availability}) {
    const reasons = availability.reason_codes.map(reasonText).join('；');
    const missing = availability.missing_fields.map(reasonText).join('、');
    const hint = [reasons, missing ? `缺失：${missing}` : '', availability.coverage !== null ? `覆盖 ${(availability.coverage * 100).toFixed(0)}%` : '']
        .filter(Boolean).join(' · ');
    return (
        <span className={`neo2-badge neo2-availability-${availability.status}`} title={hint || undefined}>
            {AVAILABILITY_ZH[availability.status]}
            {hint ? <small>{hint}</small> : null}
        </span>
    );
}

export function StateBadge({kind, state}: {kind: 'case' | 'plan' | 'task'; state: string}) {
    const zh = kind === 'case' ? CASE_STATE_ZH[state] : kind === 'plan' ? PLAN_STATE_ZH[state] : TASK_STATE_ZH[state];
    return <span className={`neo2-badge neo2-state-${state}`}>{zh ?? state}</span>;
}

export function Card({title, children, actions}: {title?: ReactNode; children: ReactNode; actions?: ReactNode}) {
    return (
        <section className="neo2-card">
            {(title || actions) && (
                <div className="neo2-card-head">
                    {title ? <h2>{title}</h2> : null}
                    {actions ? <div className="neo2-card-actions">{actions}</div> : null}
                </div>
            )}
            {children}
        </section>
    );
}

export function Notice({tone, children}: {tone: 'error' | 'info' | 'success'; children: ReactNode}) {
    return <p className={`neo2-notice neo2-notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</p>;
}

export function MetricCard({result, onEvidence}: {result: MetricResult; onEvidence?: (result: MetricResult) => void}) {
    const denominator = formatMetricDenominator(result);
    const unavailable = result.availability.status === 'blocked' || result.availability.status === 'not_supported';
    return (
        <div className={`neo2-card neo2-metric${unavailable ? ' neo2-metric-unavailable' : ''}`}>
            <span className="neo2-metric-label">{metricLabel(result.metric_id)}</span>
            <strong>{formatMetricValue(result)}</strong>
            {denominator ? <small>{denominator}</small> : null}
            <AvailabilityBadge availability={result.availability} />
            {onEvidence ? (
                <button type="button" className="neo2-link" onClick={() => onEvidence(result)}>查看口径与证据</button>
            ) : null}
            <small className="neo2-metric-meta">计算于 {formatDateTime(result.calculated_at)}</small>
        </div>
    );
}

export type EvidenceSection = {title: string; meta?: string; json: unknown};

/** Evidence drawer shown across all case tabs — source records, versions and limits, never fabricated. */
export function EvidenceDrawer({title, sections, onClose}: {title: string; sections: EvidenceSection[]; onClose: () => void}) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        if (ref.current && !ref.current.open) ref.current.showModal();
    }, []);
    return (
        <dialog ref={ref} className="neo2-dialog" aria-label="证据抽屉" onCancel={onClose} onClose={onClose}>
            <button type="button" className="neo2-close" onClick={() => ref.current?.close()}>关闭</button>
            <h2>{title}</h2>
            <p className="neo2-note">证据来自不可变快照与服务端计算结果；未知值显示为 null，不用 0 填充。</p>
            {sections.map((section, index) => (
                <section key={index} className="neo2-evidence-section">
                    <h3>{section.title}</h3>
                    {section.meta ? <p className="neo2-note">{section.meta}</p> : null}
                    <pre>{JSON.stringify(section.json, null, 2)}</pre>
                </section>
            ))}
        </dialog>
    );
}

/** Case state transition control: only legal transitions render, each requiring a reason. */
export function TransitionControl({state, transitions, onTransition}: {
    state: string;
    transitions: Array<{to: string; label: string}>;
    onTransition: (to: string, reason: string) => Promise<void>;
}) {
    const [open, setOpen] = useState(false);
    const [target, setTarget] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const start = (to: string) => {
        setTarget(to);
        setReason('');
        setError('');
        setOpen(true);
    };
    const submit = async () => {
        setBusy(true);
        setError('');
        try {
            await onTransition(target, reason);
            setOpen(false);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="neo2-transitions">
            {transitions.map((t) => (
                <button key={t.to} type="button" disabled={t.to === state} onClick={() => start(t.to)}>{t.label}</button>
            ))}
            {open ? (
                <form
                    className="neo2-reason-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void submit();
                    }}
                >
                    <label>
                        流转到「{CASE_STATE_ZH[target] ?? target}」的原因（必填）
                        <textarea value={reason} required minLength={1} rows={2}
                            onChange={(e) => setReason(e.target.value)} placeholder="说明原因，将记入事件历史"/>
                    </label>
                    {error ? <Notice tone="error">{error}</Notice> : null}
                    <div className="neo2-actions">
                        <button type="submit" disabled={busy || !reason.trim()}>{busy ? '提交中' : '确认流转'}</button>
                        <button type="button" onClick={() => setOpen(false)}>取消</button>
                    </div>
                </form>
            ) : null}
        </div>
    );
}

export function EmptyState({title, children}: {title: string; children?: ReactNode}) {
    return (
        <div className="neo2-empty">
            <h3>{title}</h3>
            {children}
        </div>
    );
}
