export const AVAILABILITY_STATUSES = ['available', 'partial', 'blocked', 'not_supported'] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export type Availability = {
    status: AvailabilityStatus;
    reason_codes: string[];
    coverage: number | null;
    missing_fields: string[];
};

/** Worst status wins so a composite result cannot look better than its weakest input. */
const RANK: Record<AvailabilityStatus, number> = {available: 0, partial: 1, blocked: 2, not_supported: 3};

export function availability(
    status: AvailabilityStatus,
    reasonCodes: string[] = [],
    coverage: number | null = null,
    missingFields: string[] = [],
): Availability {
    return {status, reason_codes: [...reasonCodes], coverage, missing_fields: [...missingFields]};
}

export function worstAvailability(values: Availability[]): Availability {
    if (values.length === 0) return availability('not_supported', ['NO_INPUT'], null, []);
    const worst = values.reduce((left, right) => (RANK[right.status] > RANK[left.status] ? right : left));
    return {
        status: worst.status,
        reason_codes: [...new Set(values.flatMap((value) => value.reason_codes))],
        coverage: worst.coverage,
        missing_fields: [...new Set(values.flatMap((value) => value.missing_fields))],
    };
}
