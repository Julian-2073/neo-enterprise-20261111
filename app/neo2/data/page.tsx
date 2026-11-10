"use client";
// 数据接入 (D01): 上传或载入验收样例 → 暂存预览 → 确认入库生成不可变快照 → 检测缺码信号。
// 所有校验（重复文件、金额越界、未知 SKU、活动引用）都由服务端裁决，页面只展示结果。

import {useRef, useState} from 'react';
import {Neo2Shell} from '../../../components/neo2/shell';
import {useNeo2Session} from '../../../components/neo2/session';
import {SnapshotsBar} from '../../../components/neo2/scope';
import {Card, Notice, AvailabilityBadge, EmptyState} from '../../../components/neo2/ui';
import {v2post, withBusiness, errorMessage} from '../../../components/neo2/api';
import {buildBaselineInput, buildCurrentInput} from '../../../components/neo2/demo-input';
import {reasonText} from '../../../components/neo2/labels';
import type {ImportPreview, ConfirmResult} from '../../../components/neo2/types';

export default function Page() {
    return (
        <Neo2Shell active="data" title="数据接入与质量" subtitle="导入 neo.store-input.v2 JSON，生成不可变快照；样例数据明确标注为合成。">
            <DataBody />
        </Neo2Shell>
    );
}

function DataBody() {
    const session = useNeo2Session();
    return (
        <>
            <ImportCard />
            <SnapshotCard />
            <CapabilityCard />
        </>
    );
}

type StagedImport = {preview: ImportPreview; slot: 'current' | 'baseline'};

function ImportCard() {
    const session = useNeo2Session();
    const [staged, setStaged] = useState<StagedImport | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);

    const stage = async (input: unknown, slot: 'current' | 'baseline') => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const preview = await v2post<ImportPreview>(withBusiness('/api/v2/store/imports', session.businessId), input);
            setStaged({preview, slot});
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    const onFile = async (file: File) => {
        try {
            const text = await file.text();
            await stage(JSON.parse(text), 'current');
        } catch (e) {
            setError(`文件读取或解析失败：${errorMessage(e)}`);
        }
    };

    const confirm = async () => {
        if (!staged) return;
        setBusy(true);
        setError('');
        try {
            const result = await v2post<ConfirmResult>(
                withBusiness(`/api/v2/store/imports/${encodeURIComponent(staged.preview.import_id)}/confirm`, session.businessId),
                {validation_revision: staged.preview.validation_revision},
            );
            session.setSnapshots({
                current: staged.slot === 'current' ? result.snapshot_id : session.snapshots.current,
                baseline: staged.slot === 'baseline' ? result.snapshot_id : session.snapshots.baseline,
            });
            setStaged(null);
            setNotice(`入库成功，快照 ID：${result.snapshot_id}${staged.slot === 'baseline' ? '（已记为基线快照）' : '（已记为当前快照）'}`);
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    const loadDemo = async () => {
        await stage(buildBaselineInput(session.businessId), 'baseline');
        setNotice('已生成基线周样例预览：确认入库后，再载入当周样例。');
    };

    const loadDemoCurrent = async () => {
        await stage(buildCurrentInput(session.businessId), 'current');
        setNotice('已生成当周样例预览：其中 R100 黑色 41 码为缺货核心码，确认后可检测缺码信号。');
    };

    return (
        <Card title="导入 neo.store-input.v2">
            <p className="neo2-note">支持两种方式：上传 JSON 文件（记为当前快照），或载入验收样例（基线周 + 当周，两步确认）。</p>
            <div className="neo2-actions">
                <input ref={fileRef} type="file" accept="application/json,.json" aria-label="选择 store-input JSON 文件"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void onFile(file);
                    }} />
                <button type="button" disabled={busy} onClick={loadDemo}>载入验收样例·基线周</button>
                <button type="button" disabled={busy} onClick={loadDemoCurrent}>载入验收样例·当周</button>
            </div>
            {busy ? <p className="neo2-note">处理中…</p> : null}
            {error ? <Notice tone="error">{error}</Notice> : null}
            {notice && !staged ? <Notice tone="success">{notice}</Notice> : null}
            {staged ? (
                <PreviewPanel staged={staged} busy={busy} onConfirm={confirm} onCancel={() => setStaged(null)} />
            ) : null}
        </Card>
    );
}

function PreviewPanel({staged, busy, onConfirm, onCancel}: {
    staged: StagedImport;
    busy: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const preview = staged.preview;
    const failed = preview.status !== 'ready';
    return (
        <div className="neo2-evidence-section">
            <h3>暂存预览{preview.reused ? '（相同文件已存在，复用同一导入）' : ''}</h3>
            <dl className="neo2-kv">
                <div><dt>import_id</dt><dd>{preview.import_id}</dd></div>
                <div><dt>粒度</dt><dd>{preview.grain}</dd></div>
                <div><dt>校验版本</dt><dd>{preview.validation_revision}</dd></div>
                <div><dt>状态</dt><dd>{failed ? '校验失败' : '可确认'}</dd></div>
            </dl>
            <h4>行数统计</h4>
            <ul>
                {Object.entries(preview.counts).map(([key, value]) => <li key={key} className="neo2-item-meta">{key}：{value}</li>)}
            </ul>
            <h4>能力预览</h4>
            <ul className="neo2-list">
                {Object.entries(preview.capability_preview).map(([key, availability]) => (
                    <li key={key}>
                        <span className="neo2-item-meta">{key}</span>{' '}
                        <AvailabilityBadge availability={{...availability, coverage: null, missing_fields: []}} />
                    </li>
                ))}
            </ul>
            {preview.isolated_skus.length > 0 ? (
                <Notice tone="info">未知 SKU 已隔离（不影响有效数据）：{preview.isolated_skus.join('、')}</Notice>
            ) : null}
            {preview.warnings.length > 0 ? (
                <ul className="neo2-list">
                    {preview.warnings.map((w, i) => (
                        <li key={i}><span className="neo2-item-meta">警告 {reasonText(w.code)}：{w.message}（{w.path}）</span></li>
                    ))}
                </ul>
            ) : null}
            {preview.errors.length > 0 ? (
                <ul className="neo2-list">
                    {preview.errors.map((e, i) => (
                        <li key={i}><span className="neo2-inline-error">错误 {reasonText(e.code)}：{e.message}（{e.path}）</span></li>
                    ))}
                </ul>
            ) : null}
            <div className="neo2-actions">
                <button type="button" disabled={busy || failed} onClick={onConfirm}>确认入库（生成快照{staged.slot === 'baseline' ? '·基线' : '·当前'}）</button>
                <button type="button" disabled={busy} onClick={onCancel}>放弃</button>
            </div>
            <p className="neo2-sr-hint">确认后数据进入不可变快照；修改数据须重新上传（校验版本 +1，旧确认自动失效）。</p>
        </div>
    );
}

function SnapshotCard() {
    const session = useNeo2Session();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const detect = async () => {
        if (!session.snapshots.current) return;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const result = await v2post<{case: {case_id: string}}>(
                withBusiness('/api/v2/store/signals/detect', session.businessId),
                {snapshot_id: session.snapshots.current},
            );
            setNotice(`已检测缺码信号，事件就绪：${result.case.case_id}`);
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card title="快照与信号">
            <SnapshotsBar />
            <div className="neo2-actions">
                <button type="button" disabled={busy || !session.snapshots.current} onClick={detect}>检测缺码信号（当前快照）</button>
            </div>
            {error ? <Notice tone="error">{error}</Notice> : null}
            {notice ? <Notice tone="success">{notice}</Notice> : null}
            <p className="neo2-note">缺码检测只针对标记为 core 的 SKU 且可售数量为 0 的记录；检测产生的事件可在今日经营或行动中心处理。</p>
        </Card>
    );
}

function CapabilityCard() {
    const session = useNeo2Session();
    const capabilities = session.capabilities;
    if (!capabilities) return null;
    const plan = capabilities.capabilities;
    return (
        <Card title="当前角色能力清单">
            <dl className="neo2-kv">
                <div><dt>角色</dt><dd>{capabilities.role}（来源：{capabilities.role_source}）</dd></div>
                <div><dt>成本字段</dt><dd>{plan.cost_fields.status === 'available' ? '可见' : reasonText(plan.cost_fields.reason_codes[0] ?? plan.cost_fields.status)}</dd></div>
                <div><dt>门店目录</dt><dd>{plan.stores.status === 'available' ? '可用' : reasonText(plan.stores.reason_codes[0] ?? plan.stores.status)}</dd></div>
            </dl>
            <h3>动作模板</h3>
            {plan.actions.length === 0 ? <EmptyState title="无动作模板" /> : (
                <ul className="neo2-list">
                    {plan.actions.map((action) => (
                        <li key={action.action_template_id}>
                            <div className="neo2-item-head">
                                <strong>{action.action_template_id}</strong>
                                <span className={`neo2-badge ${action.allowed ? 'neo2-availability-available' : 'neo2-availability-not_supported'}`}>
                                    {action.allowed ? '可执行' : '不可执行'}
                                </span>
                            </div>
                            {action.reason_codes.length > 0 ? (
                                <p className="neo2-item-meta">{action.reason_codes.map(reasonText).join('；')}</p>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}
