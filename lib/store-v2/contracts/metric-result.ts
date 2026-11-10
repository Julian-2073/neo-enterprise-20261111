import {assertCents, MAX_SAFE_CENTS} from './money.ts';
import {AVAILABILITY_STATUSES, type Availability} from './availability.ts';
import {v2assert} from './errors.ts';

export const METRIC_UNITS = ['CNY_cents', 'count', 'quantity', 'ratio_numerator'] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

export type MetricResult = {
    metric_result_id: string;
    metric_id: string;
    metric_contract_version: string;
    scope_hash: string;
    snapshot_id: string;
    value: number | null;
    unit: MetricUnit;
    denominator: number | null;
    availability: Availability;
    evidence_ids: string[];
    calculated_at: string;
};

export type MetricResultInput = Omit<MetricResult, 'metric_result_id'> & {metric_result_id?: string};

function availabilityBlocked(status: Availability['status']): boolean {
    return status === 'blocked' || status === 'not_supported';
}

function text(value: unknown, field: string, max = 160): string {
    v2assert(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, 'INVALID_METRIC_RESULT', `${field} 不合法`, {field});
    return value.trim();
}

/**
 * Single constructor for every published metric.
 * A blocked/not_supported result can only carry null; a proven zero is a real zero.
 */
export function buildMetricResult(input: MetricResultInput): MetricResult {
    const availability = input.availability;
    v2assert(availability && AVAILABILITY_STATUSES.includes(availability.status), 'INVALID_METRIC_RESULT', 'availability.status 不合法');
    v2assert(Array.isArray(availability.reason_codes) && availability.reason_codes.every((code) => typeof code === 'string'), 'INVALID_METRIC_RESULT', 'reason_codes 须为字符串数组');
    v2assert(availability.coverage === null || (typeof availability.coverage === 'number' && availability.coverage >= 0 && availability.coverage <= 1), 'INVALID_METRIC_RESULT', 'coverage 须为 0–1 或 null');
    v2assert(Array.isArray(availability.missing_fields), 'INVALID_METRIC_RESULT', 'missing_fields 须为数组');
    v2assert(input.scope_hash.length === 64 && /^[0-9a-f]{64}$/.test(input.scope_hash), 'INVALID_METRIC_RESULT', 'scope_hash 须为 64 位小写十六进制');
    v2assert(METRIC_UNITS.includes(input.unit), 'INVALID_METRIC_RESULT', 'unit 不合法');

    let value: number | null = null;
    if (input.value != null) {
        value = assertCents(input.value, 'value');
        v2assert(!availabilityBlocked(availability.status), 'INVALID_METRIC_RESULT',
            '不可用指标不得携带数值；未知用 null，不用 0 填充', {status: availability.status});
    } else {
        v2assert(availabilityBlocked(availability.status) || availability.status === 'partial', 'INVALID_METRIC_RESULT',
            'available 指标必须有值；未知值用 null 并标记 partial/blocked/not_supported');
    }

    let denominator: number | null = null;
    if (input.denominator != null) {
        v2assert(Number.isSafeInteger(input.denominator) && input.denominator >= 0 && input.denominator <= MAX_SAFE_CENTS,
            'INVALID_METRIC_RESULT', 'denominator 须为非负安全整数', {minimum: 0, maximum: MAX_SAFE_CENTS});
        denominator = input.denominator;
    }

    v2assert(Array.isArray(input.evidence_ids) && input.evidence_ids.every((id) => typeof id === 'string' && id.length > 0), 'INVALID_METRIC_RESULT', 'evidence_ids 不合法');
    v2assert(typeof input.calculated_at === 'string' && !Number.isNaN(Date.parse(input.calculated_at)), 'INVALID_METRIC_RESULT', 'calculated_at 不合法');

    const metricId = text(input.metric_id, 'metric_id');
    const metricResultId = input.metric_result_id ?? `mr_${metricId}_${input.scope_hash.slice(0, 16)}`;
    return {
        metric_result_id: text(metricResultId, 'metric_result_id'),
        metric_id: metricId,
        metric_contract_version: text(input.metric_contract_version, 'metric_contract_version', 80),
        scope_hash: input.scope_hash,
        snapshot_id: text(input.snapshot_id, 'snapshot_id'),
        value,
        unit: input.unit,
        denominator,
        availability,
        evidence_ids: [...input.evidence_ids],
        calculated_at: input.calculated_at,
    };
}
