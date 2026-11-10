import type { Batch, Fact } from './contracts.ts';
import { assert } from './errors.ts';

// Resolve all imported history from frozen, scoped records, never the wall clock.
// Do not intersect away gaps in individual sources or promote inventory to sales.
export function importedPeriod(facts: Array<{kind: string; fact: Fact}>, batches: Batch[], asOf: string) {
    const rows = facts.filter(r => ['events', 'orders', 'expenses'].includes(r.kind) && r.fact.business_date <= asOf);
    assert(rows.length > 0, 422, 'NO_IMPORTED_HISTORY', '尚无可统计的经营记录；不能用库存日期推造经营期间');
    const start = rows.reduce((day, r) => r.fact.business_date < day ? r.fact.business_date : day, rows[0].fact.business_date);
    const last = rows.reduce((day, r) => r.fact.business_date > day ? r.fact.business_date : day, start);
    const kinds = new Set(rows.map(r => r.kind));
    const relevant = batches.filter(b => kinds.has(b.kind) && b.coverage_start <= last && b.coverage_end >= start);
    const declaredEnd = relevant.reduce((day, b) => b.coverage_end > day ? b.coverage_end : day, last);
    const date = new Date(`${last}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + (7 - date.getUTCDay()) % 7);
    const weekEnd = date.toISOString().slice(0, 10);
    const end = [weekEnd, declaredEnd, asOf].sort()[0];
    return {start, end};
}
