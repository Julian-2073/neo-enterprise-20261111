import {v2assert} from './errors.ts';

export type Window = {start: string; end: string};
export type OrderScopeMode = 'matched_lines' | 'whole_orders';

export type Scope = {
    workspace_id: string;
    store_ids: string[];
    window: Window;
    baseline: Window | null;
    business_timezone: string;
    snapshot_id: string;
    metric_contract_version: string;
    view_policy_version: string;
    order_scope_mode: OrderScopeMode;
    filters: Record<string, string | number | boolean | Array<unknown> | null>;
};

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

function text(value: unknown, field: string, max = 160): string {
    v2assert(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max,
        'INVALID_SCOPE', `${field} 须为 1–${max} 字符`, {field});
    return value.trim();
}

function instant(value: unknown, field: string): string {
    v2assert(typeof value === 'string' && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value)),
        'INVALID_SCOPE', `${field} 须为带时区的 ISO 时间`, {field});
    return value;
}

function window(value: unknown, field: string): Window {
    v2assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_SCOPE', `${field} 须为时间窗口`, {field});
    const input = value as Record<string, unknown>;
    const result = {start: instant(input.start, `${field}.start`), end: instant(input.end, `${field}.end`)};
    v2assert(Date.parse(result.start) < Date.parse(result.end), 'INVALID_SCOPE', `${field} 起止顺序不正确`, {field});
    return result;
}

/** Validates the v2 Scope envelope. Unknown input is rejected, never defaulted. */
export function parseScope(input: unknown): Scope {
    v2assert(input !== null && typeof input === 'object' && !Array.isArray(input), 'INVALID_SCOPE', 'scope 须为对象');
    const raw = input as Record<string, unknown>;
    v2assert(Array.isArray(raw.store_ids) && raw.store_ids.length >= 1, 'INVALID_SCOPE', 'store_ids 至少包含一个门店');
    const storeIds = (raw.store_ids as unknown[]).map((value) => text(value, 'store_ids[]'));
    v2assert(new Set(storeIds).size === storeIds.length, 'INVALID_SCOPE', 'store_ids 不得重复');
    v2assert(raw.baseline === null || raw.baseline !== undefined, 'INVALID_SCOPE', 'baseline 须显式为 null 或时间窗口');
    v2assert(raw.filters !== null && typeof raw.filters === 'object' && !Array.isArray(raw.filters), 'INVALID_SCOPE', 'filters 须为对象');
    const filters: Scope['filters'] = {};
    for (const [key, value] of Object.entries(raw.filters as Record<string, unknown>)) {
        v2assert(key.length > 0 && key.length <= 80, 'INVALID_SCOPE', 'filters 键名长度不合法', {key});
        const valid = value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value);
        v2assert(valid, 'INVALID_SCOPE', `filters.${key} 类型不受支持`, {key});
        filters[key] = Array.isArray(value) ? [...value] : (value as string | number | boolean | null);
    }
    v2assert(raw.order_scope_mode === 'matched_lines' || raw.order_scope_mode === 'whole_orders',
        'INVALID_SCOPE', 'order_scope_mode 须为 matched_lines 或 whole_orders');
    return {
        workspace_id: text(raw.workspace_id, 'workspace_id'),
        store_ids: storeIds,
        window: window(raw.window, 'window'),
        baseline: raw.baseline === null || raw.baseline === undefined ? null : window(raw.baseline, 'baseline'),
        business_timezone: text(raw.business_timezone, 'business_timezone', 80),
        snapshot_id: text(raw.snapshot_id, 'snapshot_id'),
        metric_contract_version: text(raw.metric_contract_version, 'metric_contract_version', 80),
        view_policy_version: text(raw.view_policy_version, 'view_policy_version', 80),
        order_scope_mode: raw.order_scope_mode,
        filters,
    };
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
    }
    return value;
}

/** Stable scope identity: object key order is irrelevant, array order (stores, filter lists) is meaningful. */
export async function scopeHash(scope: Scope): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(canonical(scope)));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
