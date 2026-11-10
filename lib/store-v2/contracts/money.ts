import {StoreV2Error, v2assert} from './errors.ts';

/** All v2 amounts are integer cents. Values outside the JS safe range are rejected, never rounded. */
export const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;
export const MIN_SAFE_CENTS = Number.MIN_SAFE_INTEGER;
export const DEFAULT_CURRENCY = 'CNY';

export type Money = {cents: number; currency: string};

export function assertCents(value: unknown, field = 'amount'): number {
    v2assert(typeof value === 'number' && !Number.isNaN(value), 'INVALID_MONEY',
        `${field} 必须是数字分`, {field, value: typeof value === 'number' ? value : typeof value});
    v2assert(Number.isFinite(value), 'MONEY_OUT_OF_RANGE', `${field} 超出安全整数范围`, {field});
    v2assert(Number.isInteger(value), 'INVALID_MONEY', `${field} 必须是整数分`, {field});
    v2assert(Number.isSafeInteger(value), 'MONEY_OUT_OF_RANGE',
        `${field} 超出安全整数范围，请拆分或改用十进制字符串协议`, {field});
    return value;
}

/** null/undefined stay unknown. Zero is only returned when callers pass a real zero. */
export function observedCents(value: number | null | undefined): number | null {
    return value == null ? null : assertCents(value);
}

export function assertCurrency(value: unknown): string {
    v2assert(typeof value === 'string' && /^[A-Z]{3}$/.test(value), 'INVALID_MONEY', '币种须为三位大写字母代码');
    return value;
}

export function money(cents: number | null | undefined, currency: string = DEFAULT_CURRENCY): Money | null {
    const value = observedCents(cents);
    return value == null ? null : {cents: value, currency: assertCurrency(currency)};
}

/**
 * Sum that preserves unknowns: one missing value makes the total unknown (null).
 * Known-only subtotal is available through sumKnown for diagnostics, never as a reported total.
 */
export function totalCents(values: Array<number | null | undefined>): number | null {
    if (values.length === 0) return 0;
    const total = sumKnown(values);
    return values.some((value) => value == null) ? null : total;
}

/** Sum of the known values using BigInt so intermediate overflow cannot silently wrap. */
export function sumKnown(values: Array<number | null | undefined>): number | null {
    let sum = BigInt(0);
    let seen = false;
    for (const value of values) {
        if (value == null) continue;
        seen = true;
        sum += BigInt(assertCents(value));
    }
    if (!seen) return null;
    v2assert(sum <= BigInt(MAX_SAFE_CENTS) && sum >= BigInt(MIN_SAFE_CENTS), 'MONEY_OUT_OF_RANGE',
        '金额汇总超出安全整数范围', {count: values.length});
    return Number(sum);
}
