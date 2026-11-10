import {v2assert} from './errors.ts';

export type CaseState = 'detected' | 'investigating' | 'decision_ready' | 'acting' | 'observing' | 'reviewed' | 'closed';
export type PlanState = 'draft' | 'submitted' | 'approved' | 'rejected' | 'withdrawn' | 'superseded';
export type TaskState = 'pending_confirmation' | 'ready' | 'in_progress' | 'pending_verification' | 'blocked' | 'completed' | 'cancelled';

/** Mirrors contracts/state_machines.json. Order is the declared contract order. */
export const CASE_TRANSITIONS: Record<CaseState, CaseState[]> = {
    detected: ['investigating'],
    investigating: ['decision_ready', 'reviewed'],
    decision_ready: ['acting', 'investigating'],
    acting: ['observing', 'investigating'],
    observing: ['reviewed', 'investigating'],
    reviewed: ['closed', 'investigating'],
    closed: ['investigating'],
};

export const PLAN_TRANSITIONS: Record<PlanState, PlanState[]> = {
    draft: ['submitted'],
    submitted: ['approved', 'rejected', 'withdrawn'],
    approved: ['superseded'],
    rejected: [],
    withdrawn: [],
    superseded: [],
};

export const TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
    pending_confirmation: ['ready', 'cancelled'],
    ready: ['in_progress', 'blocked', 'cancelled'],
    in_progress: ['pending_verification', 'blocked', 'cancelled'],
    pending_verification: ['completed', 'in_progress', 'blocked'],
    blocked: ['ready', 'in_progress', 'cancelled'],
    completed: [],
    cancelled: [],
};

export const TASK_COMMANDS = [
    'confirm',
    'start',
    'block',
    'resume',
    'submit_completion',
    'verify',
    'return_for_revision',
    'cancel',
] as const;
export type TaskCommandName = (typeof TASK_COMMANDS)[number];

const COMMAND_TARGET: Record<TaskCommandName, TaskState> = {
    confirm: 'ready',
    start: 'in_progress',
    block: 'blocked',
    resume: 'in_progress',
    submit_completion: 'pending_verification',
    verify: 'completed',
    return_for_revision: 'in_progress',
    cancel: 'cancelled',
};

export const COMMAND_SOURCES: Record<TaskCommandName, TaskState[]> = {
    confirm: ['pending_confirmation'],
    start: ['ready'],
    block: ['ready', 'in_progress', 'pending_verification'],
    resume: ['blocked'],
    submit_completion: ['in_progress'],
    verify: ['pending_verification'],
    return_for_revision: ['pending_verification'],
    cancel: ['pending_confirmation', 'ready', 'in_progress', 'blocked'],
};

function assertEdge<T extends string>(table: Record<T, T[]>, from: T, to: T, kind: string): void {
    v2assert(table[from]?.includes(to), 'ILLEGAL_TRANSITION', `${kind} 不允许从 ${from} 流转到 ${to}`, {from, to});
}

export function assertCaseTransition(from: CaseState, to: CaseState): void {
    assertEdge(CASE_TRANSITIONS, from, to, '经营事件');
}

export function assertPlanTransition(from: PlanState, to: PlanState): void {
    assertEdge(PLAN_TRANSITIONS, from, to, '方案');
}

export function assertTaskTransition(from: TaskState, to: TaskState): void {
    assertEdge(TASK_TRANSITIONS, from, to, '任务');
}

/**
 * Resolves a task command to its next state.
 * `resume` must name the recorded previous state so it cannot jump to a state it was never blocked from.
 */
export function nextTaskState(from: TaskState | string, command: TaskCommandName, previousState?: TaskState): TaskState {
    const target = COMMAND_TARGET[command];
    v2assert(COMMAND_SOURCES[command].includes(from as TaskState), 'ILLEGAL_TRANSITION',
        `任务状态 ${from} 不允许执行 ${command}`, {from, command});
    if (command === 'resume') {
        v2assert(previousState === 'ready' || previousState === 'in_progress', 'ILLEGAL_TRANSITION',
            '恢复必须回到记录的阻塞前状态', {previousState});
        v2assert(TASK_TRANSITIONS.blocked.includes(previousState), 'ILLEGAL_TRANSITION', '阻塞前状态不可恢复', {previousState});
        assertTaskTransition('blocked', previousState);
        return previousState;
    }
    if (from === 'pending_verification' && command === 'return_for_revision') return 'in_progress';
    assertTaskTransition(from as TaskState, target);
    return target;
}

export type TaskCommand = {
    command: TaskCommandName;
    expected_version: number;
    plan_revision_id: string;
    reason: string;
    evidence_ids: string[];
    observed_at?: string | null;
    payload?: Record<string, unknown>;
};

export function validateTaskCommand(input: unknown, options: {from?: TaskState | string; previousState?: TaskState} = {}): TaskCommand & {next_state: TaskState} {
    v2assert(input !== null && typeof input === 'object' && !Array.isArray(input), 'INVALID_COMMAND', '命令须为对象');
    const raw = input as Record<string, unknown>;
    v2assert(TASK_COMMANDS.includes(raw.command as TaskCommandName), 'INVALID_COMMAND', '未知任务命令', {command: String(raw.command)});
    v2assert(Number.isSafeInteger(raw.expected_version) && (raw.expected_version as number) >= 0,
        'VERSION_REQUIRED', 'expected_version 须为非负整数', {field: 'expected_version'});
    v2assert(typeof raw.plan_revision_id === 'string' && raw.plan_revision_id.trim().length > 0, 'INVALID_COMMAND', 'plan_revision_id 不能为空');
    v2assert(typeof raw.reason === 'string' && raw.reason.trim().length > 0, 'INVALID_COMMAND', 'reason 不能为空');
    const evidence = raw.evidence_ids ?? [];
    v2assert(Array.isArray(evidence) && evidence.every((id) => typeof id === 'string' && id.length > 0), 'INVALID_COMMAND', 'evidence_ids 不合法');
    const observedAt = raw.observed_at ?? null;
    v2assert(observedAt === null || (typeof observedAt === 'string' && !Number.isNaN(Date.parse(observedAt))), 'INVALID_COMMAND', 'observed_at 不合法');
    const command = raw.command as TaskCommandName;
    const next_state = options.from == null ? COMMAND_TARGET[command] : nextTaskState(options.from, command, options.previousState);
    return {
        command,
        expected_version: raw.expected_version as number,
        plan_revision_id: raw.plan_revision_id as string,
        reason: raw.reason as string,
        evidence_ids: evidence as string[],
        observed_at: observedAt,
        payload: raw.payload as Record<string, unknown> | undefined,
        next_state,
    };
}

export type ApprovalDecision = {
    decision: 'approve' | 'reject';
    expected_version: number;
    plan_revision_id: string;
    plan_hash: string;
    reason: string;
};

export type RevisionSnapshot = {version: number; plan_revision_id: string; plan_hash: string};

/**
 * Approval is bound to an immutable plan revision. Version mismatch is CAS (409);
 * a different revision or hash means the approved content changed (412) and must be re-approved.
 */
export function assertApprovalDecision(input: unknown, current: RevisionSnapshot): ApprovalDecision {
    v2assert(input !== null && typeof input === 'object' && !Array.isArray(input), 'INVALID_COMMAND', '审批须为对象');
    const raw = input as Record<string, unknown>;
    v2assert(raw.decision === 'approve' || raw.decision === 'reject', 'INVALID_COMMAND', 'decision 须为 approve 或 reject');
    v2assert(Number.isSafeInteger(raw.expected_version) && (raw.expected_version as number) >= 0, 'VERSION_REQUIRED', 'expected_version 须为非负整数');
    v2assert(typeof raw.plan_revision_id === 'string' && raw.plan_revision_id.trim().length > 0, 'INVALID_COMMAND', 'plan_revision_id 不能为空');
    v2assert(typeof raw.plan_hash === 'string' && /^[0-9a-f]{64}$/.test(raw.plan_hash), 'INVALID_COMMAND', 'plan_hash 须为 64 位小写十六进制');
    v2assert(typeof raw.reason === 'string' && raw.reason.trim().length > 0, 'INVALID_COMMAND', 'reason 不能为空');
    v2assert(raw.expected_version === current.version, 'VERSION_CONFLICT', '方案版本已变化，请回读后重新提交', {
        expected: raw.expected_version, actual: current.version,
    });
    v2assert(raw.plan_revision_id === current.plan_revision_id && raw.plan_hash === current.plan_hash, 'PRECONDITION_FAILED',
        '审批对象已被修改，需重新审批', {plan_revision_id: current.plan_revision_id});
    return {
        decision: raw.decision,
        expected_version: raw.expected_version as number,
        plan_revision_id: raw.plan_revision_id as string,
        plan_hash: raw.plan_hash as string,
        reason: raw.reason as string,
    };
}

/** Every v2 write command must carry a client-generated key so retries cannot duplicate effects. */
export function requireIdempotencyKey(headers: Headers): string {
    const key = headers.get('idempotency-key');
    v2assert(typeof key === 'string' && key.trim().length >= 8 && key.trim().length <= 200, 'INVALID_COMMAND',
        '写操作须携带 8–200 字符的 Idempotency-Key');
    return key.trim();
}
