// Chinese labels for v2 states, action templates and reason codes.
// State machines are imported from the server contract — one source of truth.

import {CASE_TRANSITIONS, TASK_TRANSITIONS, TASK_COMMANDS, COMMAND_SOURCES} from '../../lib/store-v2/contracts/commands';
import type {CaseState, TaskState} from './types';

export {CASE_TRANSITIONS, TASK_TRANSITIONS, TASK_COMMANDS};

export const CASE_STATE_ZH: Record<string, string> = {
    detected: '新发现',
    investigating: '调查中',
    decision_ready: '方案待确认',
    acting: '行动中',
    observing: '等待观察',
    reviewed: '已复盘',
    closed: '已关闭',
};

export const CASE_TRANSITION_ZH: Record<string, string> = {
    investigating: '转入调查',
    decision_ready: '形成候选方案',
    acting: '进入执行',
    observing: '进入结果观察',
    reviewed: '提交复盘',
    closed: '关闭事件',
};

export const PLAN_STATE_ZH: Record<string, string> = {
    draft: '草稿',
    submitted: '待审批',
    approved: '已批准',
    rejected: '已退回',
    withdrawn: '已撤回',
    superseded: '已被替代',
};

export const TASK_STATE_ZH: Record<string, string> = {
    pending_confirmation: '待确认',
    ready: '待执行',
    in_progress: '执行中',
    pending_verification: '待验收',
    blocked: '受阻',
    completed: '已完成',
    cancelled: '已取消',
};

export const TASK_COMMAND_ZH: Record<string, string> = {
    confirm: '确认接单',
    start: '开始执行',
    block: '标记受阻',
    resume: '解除受阻',
    submit_completion: '提交完成',
    verify: '验收通过',
    return_for_revision: '退回修改',
    cancel: '取消任务',
};

// Commands legal from each task state, from the server-side command source table.
export const TASK_COMMANDS_BY_STATE: Record<string, string[]> = (() => {
    const map: Record<string, string[]> = {};
    for (const [command, states] of Object.entries(COMMAND_SOURCES)) {
        for (const state of states as TaskState[]) {
            (map[state] ??= []).push(command);
        }
    }
    return map;
})();

export function legalCaseTransitions(state: string): CaseState[] {
    return CASE_TRANSITIONS[state as CaseState] ?? [];
}

export const ACT_TEMPLATE_ZH: Record<string, string> = {
    ACT01: 'ACT01 规格盘点',
    ACT02: 'ACT02 上架核查',
    ACT03: 'ACT03 库存差异申请',
    ACT04: 'ACT04 调拨申请',
    ACT05: 'ACT05 补货需求',
    ACT06: 'ACT06 季节商品复核',
    ACT07: 'ACT07 优惠规则核对',
    ACT08: 'ACT08 搭配执行检查',
    ACT09: 'ACT09 复盘与交接',
};

export const REASON_CODE_ZH: Record<string, string> = {
    GRAIN_NOT_SUPPORTED: '数据粒度不支持',
    GRAIN_REJECTS_RETURNS: '该粒度不含退款明细',
    GRAIN_REJECTS_CAMPAIGN_LINKS: '该粒度不含活动订单关联',
    COST_PARTIAL: '成本数据部分缺失',
    ZERO_BASELINE: '基线为零',
    ZERO_BASELINE_RATIO_UNDEFINED: '零基线，变化率未定义',
    READ_ONLY: '只读成员',
    ROLE_COST_FIELDS_BLOCKED: '角色成本字段受限',
    STORE_DIRECTORY_NOT_IMPLEMENTED: '门店目录未接入',
    NO_SALES_ROWS: '无销售数据行',
    NO_CAMPAIGN_LINKS: '无活动订单关联',
    NO_INPUT: '无输入数据',
    UNKNOWN_SKU: '未知 SKU（已隔离）',
    MISSING_FIELD: '缺少必填字段',
    STORES: '门店目录',
    BASELINE_AMOUNT: '基线金额',
};

export function reasonText(code: string): string {
    return REASON_CODE_ZH[code] ?? code;
}

export const METRIC_LABEL: Record<string, string> = {
    sales_amount_total_change: '销售额变化（折后·退货前）',
    sales_amount_total_change_ratio: '销售额变化率',
    sales_quantity_total_change: '销售数量变化',
    gross_margin_change: '商品毛利变化',
    order_count_change: '订单数变化',
    core_size_quantity_share: '核心尺码可售占比',
    style_color_amount_share: '款色销售额占比',
    campaign_dedup_order_count: '活动去重订单数',
    campaign_allocated_discount: '活动优惠分摊',
    campaign_net_result: '活动净结果',
};

export function metricLabel(id: string): string {
    return METRIC_LABEL[id] ?? id;
}

export const HYPOTHESIS_STATUS_ZH: Record<string, string> = {
    pending_check: '待核查',
    supported: '证据支持',
    conflicting: '存在冲突',
    excluded: '已排除',
    not_supported: '暂不支持',
};

export function hypothesisStatusZh(status: string): string {
    return HYPOTHESIS_STATUS_ZH[status] ?? status;
}
