// Synthetic acceptance sample for the /neo2 UI. Clearly labelled synthetic data
// that walks the real stage→confirm→snapshot pipeline; never mixed into real facts.

import type {StoreInput, OrderLine} from '../../lib/store-v2/import/contract';

type SkuSeed = {
    source_sku_id: string;
    style_id: string;
    style_color_id: string;
    name: string;
    category: string;
    color: string;
    size_code: string;
    size_system: string;
    role?: string;
};

const SKUS: SkuSeed[] = [
    {source_sku_id: 'R100-BLK-41', style_id: 'R100', style_color_id: 'R100-BLK', name: 'R100 主推运动鞋 黑 41', category: '运动鞋', color: '黑', size_code: '41', size_system: 'EU', role: 'core'},
    {source_sku_id: 'R100-BLK-42', style_id: 'R100', style_color_id: 'R100-BLK', name: 'R100 主推运动鞋 黑 42', category: '运动鞋', color: '黑', size_code: '42', size_system: 'EU', role: 'core'},
    {source_sku_id: 'R100-WHT-40', style_id: 'R100', style_color_id: 'R100-WHT', name: 'R100 运动鞋 白 40', category: '运动鞋', color: '白', size_code: '40', size_system: 'EU'},
    {source_sku_id: 'R200-NVY-M', style_id: 'R200', style_color_id: 'R200-NVY', name: 'R200 季节薄外套 藏青 M', category: '外套', color: '藏青', size_code: 'M', size_system: 'CN'},
];

const PRICE: Record<string, {amount: number; cost: number}> = {
    'R100-BLK-41': {amount: 59900, cost: 36000},
    'R100-BLK-42': {amount: 59900, cost: 36000},
    'R100-WHT-40': {amount: 49900, cost: 30000},
    'R200-NVY-M': {amount: 39900, cost: 24000},
};

function coverage(storeId: string, start: string, end: string) {
    const ref = `demo-declaration:${storeId}:${start}:${end}`;
    return [
        {domain: 'sales', event_start: start, event_end: end, completeness: 'complete' as const, declaration_ref: ref},
        {domain: 'returns', event_start: start, event_end: end, completeness: 'complete' as const, declaration_ref: ref},
        {domain: 'stock', event_start: end, event_end: end, completeness: 'complete' as const, declaration_ref: ref},
        {domain: 'campaigns', event_start: start, event_end: end, completeness: 'complete' as const, declaration_ref: ref},
    ];
}

function orderLines(prefix: string, occurredAt: string, rows: Array<{sku: string; qty: number; orderId: string; cost: number | null}>): OrderLine[] {
    return rows.map((row, index) => ({
        source_line_id: `${prefix}-L${index + 1}`,
        source_order_id: row.orderId,
        source_sku_id: row.sku,
        occurred_at: occurredAt,
        status: 'settled',
        quantity: row.qty,
        amount_cents: PRICE[row.sku].amount * row.qty,
        total_cost_cents: row.cost === null ? null : PRICE[row.sku].cost * row.qty,
        is_gift: false,
    }));
}

function baseInput(storeId: string, asOf: string, start: string, end: string): StoreInput {
    return {
        schema_version: 'neo.store-input.v2',
        data_kind: 'synthetic',
        grain: 'order_line',
        store_id: storeId,
        source_system: 'NEO 验收样例（合成数据）',
        source_semantics_version: 'neo2-demo-2026.10',
        currency: 'CNY',
        tax_basis: 'tax_exclusive_display',
        business_timezone: 'Asia/Shanghai',
        as_of: asOf,
        domain_coverage: coverage(storeId, start, end),
        skus: SKUS.map((sku) => ({...sku, unit: '双/件'})),
        sales: [],
        returns: [],
        stock: [],
        campaigns: [],
        campaign_links: [],
    };
}

/** Baseline week: steady sales across R100 sizes. */
export function buildBaselineInput(storeId: string): StoreInput {
    const input = baseInput(storeId, '2026-10-12', '2026-10-06', '2026-10-11');
    input.sales = [
        ...orderLines('B1', '2026-10-06T11:20:00+08:00', [{sku: 'R100-BLK-41', qty: 1, orderId: 'SO-B1', cost: 36000}]),
        ...orderLines('B2', '2026-10-07T14:05:00+08:00', [{sku: 'R100-BLK-41', qty: 1, orderId: 'SO-B2', cost: 36000}]),
        ...orderLines('B3', '2026-10-08T16:40:00+08:00', [{sku: 'R100-BLK-42', qty: 1, orderId: 'SO-B3', cost: 36000}]),
        ...orderLines('B4', '2026-10-09T15:10:00+08:00', [{sku: 'R100-BLK-42', qty: 1, orderId: 'SO-B4', cost: 36000}]),
        ...orderLines('B5', '2026-10-10T19:25:00+08:00', [{sku: 'R100-WHT-40', qty: 1, orderId: 'SO-B5', cost: 30000}]),
        ...orderLines('B6', '2026-10-11T10:50:00+08:00', [{sku: 'R200-NVY-M', qty: 1, orderId: 'SO-B6', cost: 24000}]),
    ];
    input.stock = [
        {source_sku_id: 'R100-BLK-41', observed_at: '2026-10-11T21:00:00+08:00', available_quantity: 6},
        {source_sku_id: 'R100-BLK-42', observed_at: '2026-10-11T21:00:00+08:00', available_quantity: 5},
        {source_sku_id: 'R100-WHT-40', observed_at: '2026-10-11T21:00:00+08:00', available_quantity: 9},
        {source_sku_id: 'R200-NVY-M', observed_at: '2026-10-11T21:00:00+08:00', available_quantity: 28},
    ];
    return input;
}

/**
 * Current period: R100 black 41/42 drop together with zero stock on 41 (core),
 * white picks up, one campaign order, one return, and one unknown cost (blocked margin).
 */
export function buildCurrentInput(storeId: string): StoreInput {
    const input = baseInput(storeId, '2026-10-22', '2026-10-19', '2026-10-21');
    input.sales = [
        ...orderLines('C1', '2026-10-19T13:15:00+08:00', [{sku: 'R100-BLK-42', qty: 1, orderId: 'SO-C1', cost: 36000}]),
        ...orderLines('C2', '2026-10-19T17:30:00+08:00', [{sku: 'R100-WHT-40', qty: 1, orderId: 'SO-C2', cost: 30000}]),
        ...orderLines('C3', '2026-10-20T11:45:00+08:00', [
            {sku: 'R100-WHT-40', qty: 1, orderId: 'SO-C3', cost: null},
            {sku: 'R200-NVY-M', qty: 1, orderId: 'SO-C3', cost: 24000},
        ]),
        ...orderLines('C4', '2026-10-21T15:20:00+08:00', [{sku: 'R200-NVY-M', qty: 1, orderId: 'SO-C4', cost: 24000}]),
        ...orderLines('C5', '2026-10-21T18:05:00+08:00', [{sku: 'R100-WHT-40', qty: 1, orderId: 'SO-C5', cost: 30000}]),
    ];
    input.returns = [
        {source_refund_id: 'RF-C1', source_order_id: 'SO-B5', source_line_id: 'B5-L1', occurred_at: '2026-10-20T10:00:00+08:00', quantity: 1, amount_cents: 49900},
    ];
    input.stock = [
        {source_sku_id: 'R100-BLK-41', observed_at: '2026-10-21T21:00:00+08:00', available_quantity: 0},
        {source_sku_id: 'R100-BLK-42', observed_at: '2026-10-21T21:00:00+08:00', available_quantity: 3},
        {source_sku_id: 'R100-WHT-40', observed_at: '2026-10-21T21:00:00+08:00', available_quantity: 8},
        {source_sku_id: 'R200-NVY-M', observed_at: '2026-10-21T21:00:00+08:00', available_quantity: 25},
    ];
    input.campaigns = [
        {campaign_id: 'CAMP-STACK-10', revision_id: 'CAMP-STACK-10-r1', name: '袜子/鞋垫搭配满减', start_at: '2026-10-19T00:00:00+08:00', end_at: '2026-10-21T23:59:59+08:00'},
    ];
    input.campaign_links = [
        {campaign_id: 'CAMP-STACK-10', campaign_revision_id: 'CAMP-STACK-10-r1', source_line_id: 'C3-L2', source_order_id: 'SO-C3', association_type: 'order_discount', allocated_discount_cents: 2000, allocation_policy_version: 'even-1'},
    ];
    return input;
}
