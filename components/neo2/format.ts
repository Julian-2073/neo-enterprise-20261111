// Deterministic presentation formatting only.
// Business values always come from the server; unknown is null → "缺数据".
// Ratio display divides a contract ratio numerator by its denominator (same arithmetic as the contract).

import type {MetricResult} from './types';

const MISSING = '缺数据';

export function formatCents(value: number | null): string {
    if (value === null) return MISSING;
    return new Intl.NumberFormat('zh-CN', {style: 'currency', currency: 'CNY'}).format(value / 100);
}

export function formatSignedCents(value: number | null): string {
    if (value === null) return MISSING;
    const text = new Intl.NumberFormat('zh-CN', {style: 'currency', currency: 'CNY'}).format(Math.abs(value) / 100);
    return `${value > 0 ? '+' : value < 0 ? '−' : ''}${text}`;
}

export function formatCount(value: number | null, unit = ''): string {
    if (value === null) return MISSING;
    return `${value.toLocaleString('zh-CN')}${unit ? ` ${unit}` : ''}`;
}

export function formatSignedCount(value: number | null, unit = ''): string {
    if (value === null) return MISSING;
    return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('zh-CN')}${unit ? ` ${unit}` : ''}`;
}

export function formatRatioNumerator(value: number | null, denominator: number | null): string {
    if (value === null || denominator === null || denominator === 0) return MISSING;
    const ratio = value / denominator;
    return `${ratio > 0 ? '+' : ratio < 0 ? '−' : ''}${(Math.abs(ratio) * 100).toFixed(1)}%`;
}

export function formatDateTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString('zh-CN', {hour12: false});
}

export function formatMetricValue(result: MetricResult): string {
    if (result.availability.status === 'blocked' || result.availability.status === 'not_supported') return MISSING;
    switch (result.unit) {
        case 'CNY_cents': return formatSignedCents(result.value);
        case 'count': return formatSignedCount(result.value, '笔');
        case 'quantity': return formatSignedCount(result.value, '件');
        case 'ratio_numerator': return formatRatioNumerator(result.value, result.denominator);
        default: return result.value === null ? MISSING : String(result.value);
    }
}

export function formatMetricDenominator(result: MetricResult): string | null {
    if (result.denominator === null) return null;
    if (result.unit === 'CNY_cents') return `基线 ${formatCents(result.denominator)}`;
    if (result.unit === 'ratio_numerator') return `基线 ${formatCents(result.denominator)}`;
    return `基线 ${result.denominator.toLocaleString('zh-CN')}`;
}
