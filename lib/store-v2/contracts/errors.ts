/** Stable v2 error codes shared by domain contracts, application services and the v2 router. */
export type StoreV2ErrorCode =
    | 'INVALID_SCOPE'
    | 'INVALID_MONEY'
    | 'MONEY_OUT_OF_RANGE'
    | 'GRANULARITY_NOT_SUPPORTED'
    | 'INVALID_STYLE_COLOR_KEY'
    | 'INVALID_METRIC_RESULT'
    | 'INVALID_AI_OUTPUT'
    | 'INVALID_COMMAND'
    | 'VERSION_REQUIRED'
    | 'ILLEGAL_TRANSITION'
    | 'VERSION_CONFLICT'
    | 'IDEMPOTENCY_CONFLICT'
    | 'PRECONDITION_FAILED'
    | 'NOT_VISIBLE'
    | 'NOT_IMPLEMENTED'
    | 'NOT_FOUND'
    | 'METHOD_NOT_ALLOWED'
    | 'AUTH_REQUIRED'
    | 'NO_BUSINESS_ACCESS'
    | 'READ_ONLY'
    | 'ORIGIN_REJECTED'
    | 'LOCAL_AUTH_FORBIDDEN'
    | 'STORAGE_UNAVAILABLE';

const STATUS: Record<StoreV2ErrorCode, number> = {
    INVALID_SCOPE: 422,
    INVALID_MONEY: 422,
    MONEY_OUT_OF_RANGE: 422,
    GRANULARITY_NOT_SUPPORTED: 422,
    INVALID_STYLE_COLOR_KEY: 422,
    INVALID_METRIC_RESULT: 422,
    INVALID_AI_OUTPUT: 422,
    INVALID_COMMAND: 422,
    VERSION_REQUIRED: 422,
    ILLEGAL_TRANSITION: 409,
    VERSION_CONFLICT: 409,
    IDEMPOTENCY_CONFLICT: 409,
    PRECONDITION_FAILED: 412,
    NOT_VISIBLE: 404,
    NOT_IMPLEMENTED: 501,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    AUTH_REQUIRED: 401,
    NO_BUSINESS_ACCESS: 403,
    READ_ONLY: 403,
    ORIGIN_REJECTED: 403,
    LOCAL_AUTH_FORBIDDEN: 503,
    STORAGE_UNAVAILABLE: 503,
};

export class StoreV2Error extends Error {
    readonly code: StoreV2ErrorCode;
    readonly status: number;
    readonly retryable: boolean;
    readonly details: Record<string, unknown> | undefined;
    constructor(code: StoreV2ErrorCode, message: string, details?: Record<string, unknown>) {
        super(message);
        this.name = 'StoreV2Error';
        this.code = code;
        this.status = STATUS[code];
        this.retryable = code === 'STORAGE_UNAVAILABLE' || code === 'VERSION_CONFLICT';
        this.details = details;
    }
}

export function v2assert(condition: unknown, code: StoreV2ErrorCode, message: string, details?: Record<string, unknown>): asserts condition {
    if (!condition) throw new StoreV2Error(code, message, details);
}
