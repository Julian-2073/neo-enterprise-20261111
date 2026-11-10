"use client";
// 经营事件详情 (E01): 固定五页签 概览/假设检验/方案比较/审批与执行/结果复盘，证据抽屉贯穿全程。
// 页面只展示服务端校验结果；状态机与 CAS 均由服务端裁决。

import {useCallback, useEffect, useState} from 'react';
import {Neo2Shell} from '../../../components/neo2/shell';
import {useNeo2Session} from '../../../components/neo2/session';
import {Card, StateBadge, EmptyState, Notice, EvidenceDrawer, TransitionControl, type EvidenceSection} from '../../../components/neo2/ui';
import {v2get, v2post, withBusiness, errorMessage} from '../../../components/neo2/api';
import {PlanList, ReasonActions} from '../../../components/neo2/plan-view';
import {TaskList} from '../../../components/neo2/task-view';
import {
    legalCaseTransitions, CASE_TRANSITION_ZH, CASE_STATE_ZH, hypothesisStatusZh,
} from '../../../components/neo2/labels';
import {formatDateTime} from '../../../components/neo2/format';
import type {CaseRow, CaseSignal, InvestigationResult, PlanRow, ReviewRecord, TaskRow} from '../../../components/neo2/types';

const TABS = ['overview', 'investigate', 'plans', 'execute', 'review'] as const;
type TabId = (typeof TABS)[number];
const TAB_LABEL: Record<TabId, string> = {
    overview: '概览',
    investigate: '假设检验',
    plans: '方案比较',
    execute: '审批与执行',
    review: '结果复盘',
};

export default function Page() {
    return (
        <Neo2Shell active="actions" title="经营事件" subtitle="五页签闭环：概览 → 假设检验 → 方案比较 → 审批与执行 → 结果复盘；证据抽屉随时可查。">
            <CaseDetail />
        </Neo2Shell>
    );
}

type LoadedCase = {case: CaseRow; signals: CaseSignal[]};

function CaseDetail() {
    const session = useNeo2Session();
    const [caseId, setCaseId] = useState('');
    const [detail, setDetail] = useState<LoadedCase | null>(null);
    const [plans, setPlans] = useState<PlanRow[]>([]);
    const [tasks, setTasks] = useState<TaskRow[]>([]);
    const [reviews, setReviews] = useState<ReviewRecord[]>([]);
    const [error, setError] = useState('');
    const [notFound, setNotFound] = useState(false);
    const [tab, setTab] = useState<TabId>('overview');

    useEffect(() => {
        const params = new URL(window.location.href).searchParams;
        const id = params.get('case_id') ?? '';
        setCaseId(id);
        const requested = params.get('tab');
        if (requested && (TABS as readonly string[]).includes(requested)) setTab(requested as TabId);
    }, []);

    const reload = useCallback(() => {
        if (!session.businessId || !caseId) return;
        const base = `/api/v2/store/cases/${encodeURIComponent(caseId)}`;
        Promise.all([
            v2get<LoadedCase>(withBusiness(base, session.businessId)),
            v2get<{plans: PlanRow[]}>(withBusiness(`${base}/plans`, session.businessId)),
            v2get<{tasks: TaskRow[]}>(withBusiness(`${base}/tasks`, session.businessId)),
            v2get<{reviews: ReviewRecord[]}>(withBusiness(`${base}/reviews`, session.businessId)),
        ])
            .then(([d, p, t, r]) => {
                setDetail(d);
                setPlans(p.plans ?? []);
                setTasks(t.tasks ?? []);
                setReviews(r.reviews ?? []);
                setError('');
                setNotFound(false);
            })
            .catch((e) => {
                const message = errorMessage(e);
                setError(message);
                if ((e as {code?: string}).code === 'NOT_VISIBLE' || (e as {code?: string}).code === 'NOT_FOUND') setNotFound(true);
            });
    }, [session.businessId, caseId]);

    useEffect(() => {
        reload();
    }, [reload]);

    if (!caseId) {
        return <EmptyState title="未指定事件">从今日经营或行动中心选择一个事件进入。</EmptyState>;
    }
    if (notFound) {
        return <Notice tone="error">{error}</Notice>;
    }
    if (!detail) {
        return error ? <Notice tone="error">{error}</Notice> : <p className="neo2-note">读取事件中…</p>;
    }

    const caseRow = detail.case;
    const canWrite = session.role === 'admin' || session.role === 'importer';

    return (
        <>
            <Card
                title={<span className="neo2-item-head"><StateBadge kind="case" state={caseRow.state} />{caseRow.title}</span>}
                actions={<EvidenceButtons caseId={caseRow.case_id} state={caseRow.state} version={caseRow.version} signals={detail.signals} />}
            >
                <dl className="neo2-kv">
                    <div><dt>事件 ID</dt><dd>{caseRow.case_id}</dd></div>
                    <div><dt>证据快照</dt><dd>{caseRow.snapshot_id}</dd></div>
                    <div><dt>当前状态</dt><dd>{CASE_STATE_ZH[caseRow.state] ?? caseRow.state}（v{caseRow.version}）</dd></div>
                    <div><dt>创建时间</dt><dd>{formatDateTime(caseRow.created_at)}</dd></div>
                    <div><dt>更新时间</dt><dd>{formatDateTime(caseRow.updated_at)}</dd></div>
                    <div><dt>创建人</dt><dd>{caseRow.actor_id}</dd></div>
                </dl>
                <TabNav tab={tab} setTab={setTab} />
                <div className="neo2-tab-panel">
                    {tab === 'overview' ? <OverviewTab caseRow={caseRow} signals={detail.signals} canWrite={canWrite} onDone={reload} /> : null}
                    {tab === 'investigate' ? <InvestigateTab caseRow={caseRow} canWrite={canWrite} onDone={reload} /> : null}
                    {tab === 'plans' ? <PlansTab plans={plans} canWrite={canWrite} caseId={caseRow.case_id} onDone={reload} /> : null}
                    {tab === 'execute' ? <ExecuteTab plans={plans} tasks={tasks} canWrite={canWrite} canApprove={session.role === 'admin'} caseId={caseRow.case_id} onDone={reload} /> : null}
                    {tab === 'review' ? <ReviewTab caseRow={caseRow} reviews={reviews} canWrite={canWrite} onDone={reload} /> : null}
                </div>
            </Card>
        </>
    );
}

function TabNav({tab, setTab}: {tab: TabId; setTab: (t: TabId) => void}) {
    return (
        <div className="neo2-tabs" role="tablist" aria-label="事件页签">
            {TABS.map((id) => (
                <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}>
                    {TAB_LABEL[id]}
                </button>
            ))}
        </div>
    );
}

function EvidenceButtons({caseId, state, version, signals}: {
    caseId: string;
    state: string;
    version: number;
    signals: CaseSignal[];
}) {
    const [open, setOpen] = useState(false);
    const sections: EvidenceSection[] = [
        {title: '事件记录', meta: '状态机由服务端 CAS 校验；版本号写操作时必带', json: {case_id: caseId, state, version}},
        ...signals.map((signal, index) => ({
            title: `信号 ${index + 1}：${signal.kind}（不可变快照证据）`,
            meta: `signal_id ${signal.signal_id} · 快照 ${signal.snapshot_id}`,
            json: signal.payload,
        })),
    ];
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>证据抽屉（{signals.length} 条信号）</button>
            {open ? <EvidenceDrawer title="事件证据" sections={sections} onClose={() => setOpen(false)} /> : null}
        </>
    );
}

function OverviewTab({caseRow, signals, canWrite, onDone}: {
    caseRow: CaseRow;
    signals: CaseSignal[];
    canWrite: boolean;
    onDone: () => void;
}) {
    const session = useNeo2Session();
    const transitions = legalCaseTransitions(caseRow.state).map((to) => ({to, label: CASE_TRANSITION_ZH[to] ?? to}));
    return (
        <>
            <h3>已知事实（来自不可变快照信号）</h3>
            {signals.length === 0 ? <p className="neo2-note">该事件没有附加信号。</p> : (
                <ul className="neo2-list">
                    {signals.map((signal) => (
                        <li key={signal.signal_id}>
                            <div className="neo2-item-head"><strong>{signal.kind}</strong></div>
                            <p className="neo2-item-meta">signal_id {signal.signal_id}</p>
                        </li>
                    ))}
                </ul>
            )}
            <h3>状态流转</h3>
            <p className="neo2-note">仅显示服务端状态机允许的流转；关闭事件在「结果复盘」页签执行。</p>
            {canWrite && transitions.length > 0 ? (
                <TransitionControl state={caseRow.state} transitions={transitions} onTransition={async (to, reason) => {
                    await v2post(withBusiness(`/api/v2/store/cases/${encodeURIComponent(caseRow.case_id)}/transition`, session.businessId), {
                        to_state: to,
                        expected_version: caseRow.version,
                        reason,
                    });
                    onDone();
                }} />
            ) : (
                <p className="neo2-note">{canWrite ? '当前状态无可用流转。' : '只读成员不能执行状态流转。'}</p>
            )}
        </>
    );
}

function InvestigateTab({caseRow, canWrite, onDone}: {
    caseRow: CaseRow;
    canWrite: boolean;
    onDone: () => void;
}) {
    const session = useNeo2Session();
    const [result, setResult] = useState<InvestigationResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [showRaw, setShowRaw] = useState(false);

    const run = async () => {
        setBusy(true);
        setError('');
        try {
            const data = await v2post<InvestigationResult>(withBusiness(`/api/v2/store/cases/${encodeURIComponent(caseRow.case_id)}/investigate`, session.businessId), {});
            setResult(data);
            onDone();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <p className="neo2-note">
                受控 AI 调查：只产出假设与证据引用，不计算金额、不做审批、不写回任何系统；结论仍需人工判断。
                未配置真实模型密钥时使用确定性 Mock 调查，结果标注 provider。
            </p>
            {canWrite ? (
                <div className="neo2-actions">
                    <button type="button" disabled={busy} onClick={run}>{busy ? '调查中…' : '运行受控调查'}</button>
                </div>
            ) : <p className="neo2-note">只读成员不能发起调查。</p>}
            {error ? <Notice tone="error">{error}</Notice> : null}
            {result ? (
                <Card title="调查结果">
                    <p>{result.summary}</p>
                    <h3>假设（{result.hypotheses.length}）</h3>
                    <ul className="neo2-list">
                        {result.hypotheses.map((h, index) => (
                            <li key={index}>
                                <strong>{h.claim}</strong>
                                <p className="neo2-item-meta">
                                    状态：{hypothesisStatusZh('pending_check')} · 置信度 {Math.round(h.confidence * 100)}% · 证据：{h.evidence_refs.join('、') || '—'}
                                </p>
                                {h.suggested_next_step ? <p className="neo2-item-meta">建议下一步：{h.suggested_next_step}</p> : null}
                            </li>
                        ))}
                    </ul>
                    <p className="neo2-sr-hint">
                        provider：{result.provider} · trace：{result.trace_id} · 预算：{result.budget_used.tokens} tokens / {result.budget_used.steps} 步
                    </p>
                    <div className="neo2-actions">
                        <button type="button" className="neo2-link" onClick={() => setShowRaw((v) => !v)}>{showRaw ? '收起原始输出' : '查看原始输出'}</button>
                    </div>
                    {showRaw ? <pre>{JSON.stringify(result, null, 2)}</pre> : null}
                </Card>
            ) : null}
        </>
    );
}

function PlansTab({plans, canWrite, caseId, onDone}: {
    plans: PlanRow[];
    canWrite: boolean;
    caseId: string;
    onDone: () => void;
}) {
    const session = useNeo2Session();
    const [showForm, setShowForm] = useState(false);
    return (
        <>
            <p className="neo2-note">每个方案都是带版本的修订记录；比较时以版本与冻结哈希为准，不做客户端改写。</p>
            {canWrite ? (
                <div className="neo2-actions">
                    <button type="button" onClick={() => setShowForm((v) => !v)}>创建方案修订</button>
                </div>
            ) : <p className="neo2-note">只读成员不能创建方案。</p>}
            {showForm ? <PlanCreateForm caseId={caseId} onDone={() => {
                setShowForm(false);
                onDone();
            }} /> : null}
            <PlanList plans={plans} businessId={session.businessId} canWrite={canWrite} canApprove={session.role === 'admin'} onChanged={onDone} />
        </>
    );
}

function PlanCreateForm({caseId, onDone}: {caseId: string; onDone: () => void}) {
    const session = useNeo2Session();
    const [title, setTitle] = useState('');
    const [payloadText, setPayloadText] = useState(JSON.stringify({
        premise: '假设缺码是主因（来自调查）',
        cost_note: '仅记录情景参数，不由系统推算金额',
        steps: ['核查货架与库存', '提交调拨/盘点申请'],
        completion_standard: '核心码可售恢复且库存差异归零',
    }, null, 2));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [payloadError, setPayloadError] = useState('');

    const submit = async () => {
        let payload: unknown;
        try {
            payload = JSON.parse(payloadText);
            setPayloadError('');
        } catch {
            setPayloadError('情景参数必须是合法 JSON');
            return;
        }
        setBusy(true);
        setError('');
        try {
            await v2post(withBusiness(`/api/v2/store/cases/${encodeURIComponent(caseId)}/plans`, session.businessId), {title, payload});
            onDone();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="neo2-reason-form" onSubmit={(e) => {
            e.preventDefault();
            void submit();
        }}>
            <label>
                方案标题
                <input value={title} required onChange={(e) => setTitle(e.target.value)} placeholder="如：补调 R100 黑色 41 码并复盘订货口径" />
            </label>
            <label>
                情景参数（JSON，人工填写，不由 AI 生成金额）
                <textarea value={payloadText} rows={6} onChange={(e) => setPayloadText(e.target.value)} />
            </label>
            {payloadError ? <Notice tone="error">{payloadError}</Notice> : null}
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="neo2-actions">
                <button type="submit" disabled={busy || !title.trim()}>{busy ? '创建中' : '创建修订'}</button>
                <button type="button" onClick={onDone}>取消</button>
            </div>
        </form>
    );
}

function ExecuteTab({plans, tasks, canWrite, canApprove, caseId, onDone}: {
    plans: PlanRow[];
    tasks: TaskRow[];
    canWrite: boolean;
    canApprove: boolean;
    caseId: string;
    onDone: () => void;
}) {
    const session = useNeo2Session();
    return (
        <>
            <h3>审批（冻结哈希绑定）</h3>
            <p className="neo2-note">批准时服务端校验 plan_hash 与 expected_version，版本不一致即拒绝，防止审批的不是看到的版本。</p>
            <PlanList plans={plans} businessId={session.businessId} canWrite={canWrite} canApprove={canApprove} onChanged={onDone} />
            <h3>任务执行</h3>
            <TaskList tasks={tasks} businessId={session.businessId} canWrite={canWrite} onChanged={onDone} />
            <p className="neo2-note">
                事件 {caseId.slice(0, 8)}… 的外部系统（ERP/调拨）未接入：任务命令仅生成申请与记录，状态显示「待人工处理」，不会出现「已调拨」等未实现结果。
            </p>
        </>
    );
}

function ReviewTab({caseRow, reviews, canWrite, onDone}: {
    caseRow: CaseRow;
    reviews: ReviewRecord[];
    canWrite: boolean;
    onDone: () => void;
}) {
    const session = useNeo2Session();
    const reviewable = caseRow.state === 'observing' || caseRow.state === 'reviewed';
    const closeable = caseRow.state === 'reviewed' || caseRow.state === 'observing' || caseRow.state === 'acting';
    const [conclusion, setConclusion] = useState('');
    const [learnings, setLearnings] = useState('');
    const [observed, setObserved] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submitReview = async () => {
        setBusy(true);
        setError('');
        try {
            await v2post(withBusiness(`/api/v2/store/cases/${encodeURIComponent(caseRow.case_id)}/review`, session.businessId), {
                expected_version: caseRow.version,
                conclusion,
                candidate_learnings: learnings.split('\n').map((s) => s.trim()).filter(Boolean),
                observed_effect: observed.trim() || null,
            });
            setConclusion('');
            setLearnings('');
            setObserved('');
            onDone();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <h3>复盘结论（{reviews.length}）</h3>
            {reviews.length === 0 ? <p className="neo2-note">尚无复盘记录。</p> : (
                <ul className="neo2-list">
                    {reviews.map((review) => (
                        <li key={review.review_id}>
                            <strong>{review.conclusion}</strong>
                            {review.observed_effect ? <p className="neo2-item-meta">观察效果：{review.observed_effect}</p> : null}
                            {review.candidate_learnings.length > 0 ? (
                                <ul>{review.candidate_learnings.map((l, i) => <li key={i} className="neo2-item-meta">{l}</li>)}</ul>
                            ) : null}
                            <p className="neo2-item-meta">{formatDateTime(review.created_at)}</p>
                        </li>
                    ))}
                </ul>
            )}
            <p className="neo2-note">候选经验仅存入本事件，不会自动成为全局规则。</p>
            {reviewable && canWrite ? (
                <form className="neo2-reason-form" onSubmit={(e) => {
                    e.preventDefault();
                    void submitReview();
                }}>
                    <label>
                        结论（必填）
                        <textarea value={conclusion} required rows={2} onChange={(e) => setConclusion(e.target.value)} placeholder="如：缺码是可售下降主因，观察 7 天后销售恢复" />
                    </label>
                    <label>
                        候选经验（每行一条，可选）
                        <textarea value={learnings} rows={3} onChange={(e) => setLearnings(e.target.value)} placeholder={'核心码维持安全库存可降低缺码\n缺码触发应在 24 小时内处理'} />
                    </label>
                    <label>
                        观察效果（可选）
                        <input value={observed} onChange={(e) => setObserved(e.target.value)} placeholder="如：观察期销售额恢复至基线水平" />
                    </label>
                    {error ? <Notice tone="error">{error}</Notice> : null}
                    <div className="neo2-actions">
                        <button type="submit" disabled={busy || !conclusion.trim()}>{busy ? '提交中' : '提交复盘'}</button>
                    </div>
                </form>
            ) : null}
            {!reviewable && canWrite ? <p className="neo2-note">进入「等待观察」状态后才能提交复盘。</p> : null}
            {closeable && canWrite ? (
                <>
                    <h3>关闭 / 重开事件</h3>
                    <ReasonActions
                        busy={busy}
                        actions={[
                            {label: '关闭事件', reason: true, run: async (reason) => {
                                await v2post(withBusiness(`/api/v2/store/cases/${encodeURIComponent(caseRow.case_id)}/close`, session.businessId), {expected_version: caseRow.version, reason});
                                onDone();
                            }},
                            ...(caseRow.state === 'closed' ? [{label: '重开事件', reason: true, run: async (reason: string) => {
                                await v2post(withBusiness(`/api/v2/store/cases/${encodeURIComponent(caseRow.case_id)}/reopen`, session.businessId), {expected_version: caseRow.version, reason});
                                onDone();
                            }}] : []),
                        ]}
                    />
                </>
            ) : null}
        </>
    );
}
