"use client";
// Task (行动) list with state-machine commands. Completion (verify) requires evidence ids;
// external ERP writes are not implemented, so actions stay as system records only.

import {useState} from 'react';
import {v2post, withBusiness, errorMessage} from './api';
import {StateBadge, Notice, EmptyState} from './ui';
import {TASK_COMMANDS_BY_STATE, TASK_COMMAND_ZH} from './labels';
import {formatDateTime} from './format';
import type {TaskRow} from './types';

export function TaskList({tasks, businessId, canWrite, onChanged}: {
    tasks: TaskRow[];
    businessId: string;
    canWrite: boolean;
    onChanged: () => void;
}) {
    if (tasks.length === 0) {
        return <EmptyState title="尚无任务">从已批准的方案创建任务后，任务在这里流转。</EmptyState>;
    }
    return (
        <ul className="neo2-list">
            {tasks.map((task) => (
                <TaskItem key={task.task_id} task={task} businessId={businessId} canWrite={canWrite} onChanged={onChanged} />
            ))}
        </ul>
    );
}

function TaskItem({task, businessId, canWrite, onChanged}: {
    task: TaskRow;
    businessId: string;
    canWrite: boolean;
    onChanged: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const commands = TASK_COMMANDS_BY_STATE[task.state] ?? [];
    const needsEvidence = commands.includes('verify');
    const needsReason = true; // every task command carries a reason

    const runCommand = async (command: string, reason: string, evidenceIds: string[]) => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await v2post(withBusiness(`/api/v2/store/tasks/${task.task_id}/commands`, businessId), {
                command,
                expected_version: task.version,
                plan_revision_id: task.plan_revision_id,
                reason,
                evidence_ids: evidenceIds,
            });
            setNotice(`已执行：${TASK_COMMAND_ZH[command] ?? command}`);
            onChanged();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <li>
            <div className="neo2-item-head">
                <StateBadge kind="task" state={task.state} />
                <strong>{task.title}</strong>
                <span className="neo2-item-meta">{task.action_type} · v{task.version} · {formatDateTime(task.updated_at)}</span>
            </div>
            {task.state === 'blocked' && task.previous_state ? (
                <p className="neo2-item-meta">受阻前状态：{task.previous_state}（解除后回到该状态）</p>
            ) : null}
            {notice ? <Notice tone="success">{notice}</Notice> : null}
            {error ? <Notice tone="error">{error}</Notice> : null}
            {commands.length > 0 && canWrite ? (
                <TaskCommandForm commands={commands} busy={busy} needsEvidence={needsEvidence} needsReason={needsReason}
                    onRun={runCommand} />
            ) : null}
            {commands.length > 0 && !canWrite ? <small className="neo2-sr-hint">只读成员不能执行任务命令。</small> : null}
            {commands.length === 0 ? <small className="neo2-sr-hint">当前状态无可用命令（终态）。</small> : null}
        </li>
    );
}

function TaskCommandForm({commands, busy, needsEvidence, needsReason, onRun}: {
    commands: string[];
    busy: boolean;
    needsEvidence: boolean;
    needsReason: boolean;
    onRun: (command: string, reason: string, evidenceIds: string[]) => Promise<void>;
}) {
    const [command, setCommand] = useState(commands[0] ?? '');
    const [reason, setReason] = useState('');
    const [evidence, setEvidence] = useState('');
    const evidenceIds = evidence.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);

    return (
        <form className="neo2-reason-form" onSubmit={(e) => {
            e.preventDefault();
            if (command) void onRun(command, reason, evidenceIds);
        }}>
            <label>
                命令
                <select value={command} onChange={(e) => setCommand(e.target.value)}>
                    {commands.map((c) => <option key={c} value={c}>{TASK_COMMAND_ZH[c] ?? c}</option>)}
                </select>
            </label>
            {needsReason ? (
                <label>
                    原因（必填）
                    <textarea value={reason} required rows={2} onChange={(e) => setReason(e.target.value)} />
                </label>
            ) : null}
            {needsEvidence ? (
                <label>
                    证据 ID（验收完成必须提供，多个用逗号分隔）
                    <input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="如：盘点照片编号 / 现场记录 ID" />
                </label>
            ) : null}
            <div className="neo2-actions">
                <button type="submit" disabled={busy || !command || (needsReason && !reason.trim()) || (needsEvidence && evidenceIds.length === 0)}>
                    {busy ? '执行中' : `执行「${TASK_COMMAND_ZH[command] ?? command}」`}
                </button>
            </div>
            <small className="neo2-sr-hint">外部系统（调拨/ERP）未接入：命令仅生成申请与记录，不显示「已调拨」等未实现状态。</small>
        </form>
    );
}
