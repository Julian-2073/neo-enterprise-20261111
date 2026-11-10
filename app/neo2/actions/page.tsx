"use client";
// 行动中心 (A01): 全量事件列表 + 状态筛选；展开后直接查看方案与任务并执行任务命令。

import {useCallback, useEffect, useState} from 'react';
import {Neo2Shell} from '../../../components/neo2/shell';
import {useNeo2Session} from '../../../components/neo2/session';
import {Card, StateBadge, EmptyState, Notice} from '../../../components/neo2/ui';
import {v2get, withBusiness, errorMessage} from '../../../components/neo2/api';
import {caseDetailHref} from '../../../components/neo2/case-view';
import {PlanList} from '../../../components/neo2/plan-view';
import {TaskList} from '../../../components/neo2/task-view';
import {CASE_STATE_ZH} from '../../../components/neo2/labels';
import {formatDateTime} from '../../../components/neo2/format';
import type {CaseRow, PlanRow, TaskRow} from '../../../components/neo2/types';

const FILTERS: Array<{value: string; label: string}> = [
    {value: '', label: '全部'},
    ...Object.keys(CASE_STATE_ZH).map((state) => ({value: state, label: CASE_STATE_ZH[state]})),
];

export default function Page() {
    return (
        <Neo2Shell active="actions" title="行动中心" subtitle="全部经营事件与任务：展开事件即可推进状态与执行任务命令。">
            <ActionsBody />
        </Neo2Shell>
    );
}

function ActionsBody() {
    const session = useNeo2Session();
    const [filter, setFilter] = useState('');
    const [state, setState] = useState<'loading' | 'error' | 'done'>('loading');
    const [error, setError] = useState('');
    const [cases, setCases] = useState<CaseRow[]>([]);

    const load = useCallback(() => {
        if (!session.businessId) return;
        const query = filter ? `?state=${encodeURIComponent(filter)}` : '';
        setState('loading');
        v2get<{cases: CaseRow[]; total: number}>(withBusiness(`/api/v2/store/cases${query}`, session.businessId))
            .then((d) => {
                setCases(d.cases ?? []);
                setState('done');
                setError('');
            })
            .catch((e) => {
                setError(errorMessage(e));
                setState('error');
            });
    }, [session.businessId, filter]);

    useEffect(() => {
        load();
    }, [load]);

    const canWrite = session.role === 'admin' || session.role === 'importer';

    return (
        <>
            <Card title="事件列表">
                <div className="neo2-actions" role="group" aria-label="状态筛选">
                    {FILTERS.map((f) => (
                        <button key={f.value} type="button" aria-pressed={filter === f.value}
                            style={filter === f.value ? {fontWeight: 700} : undefined}
                            onClick={() => setFilter(f.value)}>{f.label}</button>
                    ))}
                </div>
                {state === 'loading' ? <p className="neo2-note">正在读取…</p> : null}
                {state === 'error' ? <Notice tone="error">{error}</Notice> : null}
                {state === 'done' && cases.length === 0 ? (
                    <EmptyState title="没有匹配的事件">
                        事件由数据接入页「检测缺码信号」产生；也可以在今日经营页处理优先事项。
                    </EmptyState>
                ) : null}
                <ul className="neo2-list">
                    {cases.map((caseRow) => <CaseRowItem key={caseRow.case_id} caseRow={caseRow} canWrite={canWrite} onChanged={load} />)}
                </ul>
            </Card>
        </>
    );
}

function CaseRowItem({caseRow, canWrite, onChanged}: {caseRow: CaseRow; canWrite: boolean; onChanged: () => void}) {
    const session = useNeo2Session();
    const [open, setOpen] = useState(false);
    const [plans, setPlans] = useState<PlanRow[] | null>(null);
    const [tasks, setTasks] = useState<TaskRow[] | null>(null);
    const [error, setError] = useState('');

    const loadChildren = useCallback(() => {
        const base = `/api/v2/store/cases/${encodeURIComponent(caseRow.case_id)}`;
        Promise.all([
            v2get<{plans: PlanRow[]}>(withBusiness(`${base}/plans`, session.businessId)),
            v2get<{tasks: TaskRow[]}>(withBusiness(`${base}/tasks`, session.businessId)),
        ])
            .then(([planRes, taskRes]) => {
                setPlans(planRes.plans ?? []);
                setTasks(taskRes.tasks ?? []);
                setError('');
            })
            .catch((e) => setError(errorMessage(e)));
    }, [caseRow.case_id, session.businessId]);

    useEffect(() => {
        if (open && plans === null && tasks === null) loadChildren();
    }, [open, plans, tasks, loadChildren]);

    return (
        <li>
            <div className="neo2-item-head">
                <StateBadge kind="case" state={caseRow.state} />
                <strong>{caseRow.title}</strong>
                <span className="neo2-item-meta">v{caseRow.version} · {formatDateTime(caseRow.updated_at)}</span>
            </div>
            <div className="neo2-item-actions">
                <button type="button" onClick={() => setOpen((v) => !v)}>{open ? '收起' : '展开方案与任务'}</button>
                <a className="neo2-link" href={caseDetailHref(session.businessId, caseRow.case_id)}>进入五页签详情</a>
            </div>
            {open ? (
                <>
                    {error ? <Notice tone="error">{error}</Notice> : null}
                    <div className="neo2-grid">
                        <div>
                            <h3>方案</h3>
                            {plans === null ? <p className="neo2-note">读取中…</p> : (
                                <PlanList plans={plans} businessId={session.businessId}
                                    canWrite={canWrite} canApprove={session.role === 'admin'} onChanged={loadChildren} />
                            )}
                        </div>
                        <div>
                            <h3>任务</h3>
                            {tasks === null ? <p className="neo2-note">读取中…</p> : (
                                <TaskList tasks={tasks} businessId={session.businessId} canWrite={canWrite} onChanged={loadChildren} />
                            )}
                        </div>
                    </div>
                    <p className="neo2-note">状态流转与假设检验在<a className="neo2-link" href={caseDetailHref(session.businessId, caseRow.case_id)}>事件详情页</a>进行，避免同一事件在两处同时变更。</p>
                </>
            ) : null}
        </li>
    );
}
