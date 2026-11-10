"use client";
// Plan revisions (方案) with frozen-hash approval actions.
// Approval binds to plan_revision_id + plan_hash + expected_version (CAS, server-verified).

import {useEffect, useRef, useState} from 'react';
import {v2post, withBusiness, errorMessage} from './api';
import {StateBadge, Notice, EmptyState} from './ui';
import {PLAN_STATE_ZH} from './labels';
import {formatDateTime} from './format';
import type {PlanRow} from './types';

function PlanPayload({plan}: {plan: PlanRow}) {
    let parsed: unknown = plan.payload;
    try {
        parsed = JSON.parse(plan.payload);
    } catch {
        // Keep raw payload text when it is not valid JSON.
    }
    return <pre>{typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)}</pre>;
}

export function PlanList({plans, businessId, canWrite, canApprove, onChanged}: {
    plans: PlanRow[];
    businessId: string;
    canWrite: boolean;
    canApprove: boolean;
    onChanged: () => void;
}) {
    if (plans.length === 0) {
        return <EmptyState title="尚无方案">先在「方案比较」页签创建方案修订。</EmptyState>;
    }
    return (
        <ul className="neo2-list">
            {plans.map((plan) => (
                <PlanItem key={plan.plan_revision_id} plan={plan} businessId={businessId}
                    canWrite={canWrite} canApprove={canApprove} onChanged={onChanged} />
            ))}
        </ul>
    );
}

function PlanItem({plan, businessId, canWrite, canApprove, onChanged}: {
    plan: PlanRow;
    businessId: string;
    canWrite: boolean;
    canApprove: boolean;
    onChanged: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [showTaskForm, setShowTaskForm] = useState(false);

    const act = async (path: string, body: unknown, done: string) => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await v2post(withBusiness(path, businessId), body);
            setNotice(done);
            onChanged();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    const disabledReason = !canWrite ? '只读成员不能执行写操作' : undefined;

    const actions: Array<{label: string; reason?: boolean; run: (reason: string) => Promise<void>}> = [];
    if (plan.state === 'draft') {
        actions.push({
            label: '提交审批',
            run: () => act(withBusiness(`/api/v2/store/plans/${plan.plan_revision_id}/submit`, businessId), {expected_version: plan.version}, '方案已提交审批'),
        });
    }
    if (plan.state === 'submitted' && canApprove) {
        actions.push({
            label: '批准方案',
            reason: true,
            run: (reason) => act(withBusiness('/api/v2/store/plans/decide', businessId), {decision: 'approve', expected_version: plan.version, plan_revision_id: plan.plan_revision_id, plan_hash: plan.plan_hash, reason}, '方案已批准（绑定当前版本哈希）'),
        });
        actions.push({
            label: '退回方案',
            reason: true,
            run: (reason) => act(withBusiness('/api/v2/store/plans/decide', businessId), {decision: 'reject', expected_version: plan.version, plan_revision_id: plan.plan_revision_id, plan_hash: plan.plan_hash, reason}, '方案已退回'),
        });
    }

    return (
        <li>
            <div className="neo2-item-head">
                <StateBadge kind="plan" state={plan.state} />
                <strong>{plan.title}</strong>
                <span className="neo2-item-meta">v{plan.version} · 哈希 {plan.plan_hash.slice(0, 12)}… · {formatDateTime(plan.updated_at)}</span>
            </div>
            <PlanPayload plan={plan} />
            {notice ? <Notice tone="success">{notice}</Notice> : null}
            {error ? <Notice tone="error">{error}</Notice> : null}
            <ReasonActions
                disabledReason={disabledReason}
                busy={busy}
                actions={actions}
            />
            {plan.state === 'approved' && canWrite ? (
                <div className="neo2-item-actions">
                    <button type="button" disabled={busy} onClick={() => setShowTaskForm((v) => !v)}>从已批方案创建任务</button>
                    {!canApprove ? <small className="neo2-sr-hint">方案审批需要管理员角色</small> : null}
                </div>
            ) : null}
            {showTaskForm ? (
                <TaskCreateForm plan={plan} businessId={businessId} onDone={() => {
                    setShowTaskForm(false);
                    onChanged();
                }} />
            ) : null}
            {plan.state === 'submitted' && !canApprove ? <small className="neo2-sr-hint">审批需要管理员角色；当前角色仅可查看。</small> : null}
            {PLAN_STATE_ZH[plan.state] === undefined ? <small className="neo2-sr-hint">未知方案状态：{plan.state}</small> : null}
        </li>
    );
}

function TaskCreateForm({plan, businessId, onDone}: {plan: PlanRow; businessId: string; onDone: () => void}) {
    const [title, setTitle] = useState('');
    const [actionType, setActionType] = useState('ACT01');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const mounted = useRef(true);
    useEffect(() => () => {
        mounted.current = false;
    }, []);

    const submit = async () => {
        setBusy(true);
        setError('');
        try {
            await v2post(withBusiness(`/api/v2/store/plans/${plan.plan_revision_id}/tasks`, businessId), {title, action_type: actionType});
            if (mounted.current) onDone();
        } catch (e) {
            if (mounted.current) setError(errorMessage(e));
        } finally {
            if (mounted.current) setBusy(false);
        }
    };

    return (
        <form className="neo2-reason-form" onSubmit={(e) => {
            e.preventDefault();
            void submit();
        }}>
            <label>
                任务标题
                <input value={title} required onChange={(e) => setTitle(e.target.value)} placeholder="如：核查 R100 黑色 41 码货架可售" />
            </label>
            <label>
                动作模板
                <select value={actionType} onChange={(e) => setActionType(e.target.value)}>
                    {['ACT01', 'ACT02', 'ACT03', 'ACT04', 'ACT05', 'ACT06', 'ACT07', 'ACT08', 'ACT09'].map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
            </label>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="neo2-actions">
                <button type="submit" disabled={busy || !title.trim()}>{busy ? '创建中' : '创建任务'}</button>
                <button type="button" onClick={onDone}>取消</button>
            </div>
        </form>
    );
}

/** Shared reason-gated action row: buttons that require a reason open an inline form. */
export function ReasonActions({actions, busy, disabledReason}: {
    actions: Array<{label: string; reason?: boolean; run: (reason: string) => Promise<void>}>;
    busy: boolean;
    disabledReason?: string;
}) {
    const [openFor, setOpenFor] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const [localBusy, setLocalBusy] = useState(false);
    const [error, setError] = useState('');

    const runAction = async (action: {label: string; run: (reason: string) => Promise<void>}) => {
        setLocalBusy(true);
        setError('');
        try {
            await action.run(reason);
            setOpenFor(null);
            setReason('');
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setLocalBusy(false);
        }
    };

    return (
        <div className="neo2-transitions">
            {actions.map((action) => (
                <span key={action.label}>
                    <button
                        type="button"
                        disabled={busy || localBusy || Boolean(disabledReason)}
                        title={disabledReason}
                        onClick={() => {
                            setError('');
                            if (action.reason) {
                                setOpenFor(openFor === action.label ? null : action.label);
                                setReason('');
                            } else {
                                void runAction(action);
                            }
                        }}
                    >{action.label}</button>
                </span>
            ))}
            {disabledReason ? <small className="neo2-sr-hint">{disabledReason}</small> : null}
            {openFor ? (
                <form className="neo2-reason-form" onSubmit={(e) => {
                    e.preventDefault();
                    const action = actions.find((a) => a.label === openFor);
                    if (action) void runAction(action);
                }}>
                    <label>
                        「{openFor}」的原因（必填）
                        <textarea value={reason} required rows={2} onChange={(e) => setReason(e.target.value)} />
                    </label>
                    {error ? <Notice tone="error">{error}</Notice> : null}
                    <div className="neo2-actions">
                        <button type="submit" disabled={localBusy || !reason.trim()}>{localBusy ? '提交中' : '确认'}</button>
                        <button type="button" onClick={() => setOpenFor(null)}>取消</button>
                    </div>
                </form>
            ) : null}
        </div>
    );
}
