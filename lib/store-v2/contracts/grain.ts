import {v2assert} from './errors.ts';

export const INPUT_GRAINS = ['order_line', 'day_sku'] as const;
export type InputGrain = (typeof INPUT_GRAINS)[number];

export type GrainMetric = 'sales' | 'order_count' | 'atv' | 'basket' | 'campaign_order_union';

/** Mirrors contracts/grain_capabilities.json. Keep in sync with the delivery package. */
export const GRAIN_CAPABILITIES: Record<InputGrain, Record<GrainMetric, boolean>> = {
    order_line: {sales: true, order_count: true, atv: true, basket: true, campaign_order_union: true},
    day_sku: {sales: true, order_count: false, atv: false, basket: false, campaign_order_union: false},
};

export function grainSupports(grain: InputGrain, metric: GrainMetric): boolean {
    return GRAIN_CAPABILITIES[grain][metric] === true;
}

export function availabilityForGrain(grain: InputGrain, metric: GrainMetric) {
    if (grainSupports(grain, metric)) {
        return {status: 'available' as const, reason_codes: [] as string[], coverage: null, missing_fields: [] as string[]};
    }
    return {
        status: 'not_supported' as const,
        reason_codes: ['GRAIN_NOT_SUPPORTED'],
        coverage: null,
        missing_fields: [metric],
    };
}

/** Throws instead of fabricating an order-level metric from day_sku rows. */
export function assertGrainSupports(grain: InputGrain, metric: GrainMetric): void {
    v2assert(grainSupports(grain, metric), 'GRANULARITY_NOT_SUPPORTED',
        `输入粒度 ${grain} 不支持 ${metric}；不得用明细行数替代`, {grain, metric});
}

export function parseGrain(value: unknown): InputGrain {
    v2assert(value === 'order_line' || value === 'day_sku', 'INVALID_SCOPE', '输入粒度须为 order_line 或 day_sku');
    return value;
}

export function isInputGrain(value: unknown): value is InputGrain {
    return value === 'order_line' || value === 'day_sku';
}
