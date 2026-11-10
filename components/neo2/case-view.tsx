"use client";
// Case (经营事件) presentation shared by 今日经营 and 行动中心.

import {StateBadge} from './ui';
import {formatDateTime} from './format';
import {withBusiness} from './api';
import type {CaseRow} from './types';

export function caseDetailHref(businessId: string, caseId: string): string {
    return withBusiness(`/neo2/cases?case_id=${encodeURIComponent(caseId)}`, businessId);
}

/** Priority card per product §8.4: 对象 + 发生什么 + 为什么关注 + 证据状态 + 最小下一步. */
export function CaseCard({caseRow, businessId}: {caseRow: CaseRow; businessId: string}) {
    return (
        <li>
            <div className="neo2-item-head">
                <StateBadge kind="case" state={caseRow.state} />
                <strong>{caseRow.title}</strong>
            </div>
            <p className="neo2-item-meta">
                事件 {caseRow.case_id.slice(0, 8)}… · 证据快照 {caseRow.snapshot_id.slice(0, 8)}… · 更新于 {formatDateTime(caseRow.updated_at)} · 版本 v{caseRow.version}
            </p>
            <div className="neo2-item-actions">
                <a className="neo2-link" href={caseDetailHref(businessId, caseRow.case_id)}>查看证据与处理</a>
            </div>
        </li>
    );
}
