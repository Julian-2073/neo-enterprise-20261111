// /api/v2/store client. Reads are plain GETs; writes always carry a fresh
// Idempotency-Key so retries cannot duplicate effects (server-enforced).

export class V2ApiError extends Error {
    code: string;
    requestId: string | null;
    retryable: boolean;
    status: number;
    details: unknown;

    constructor(status: number, code: string, message: string, options: {requestId?: string; retryable?: boolean; details?: unknown} = {}) {
        super(message);
        this.name = 'V2ApiError';
        this.status = status;
        this.code = code;
        this.requestId = options.requestId ?? null;
        this.retryable = options.retryable ?? false;
        this.details = options.details ?? null;
    }
}

type Envelope = {error?: {request_id?: string; code?: string; message?: string; retryable?: boolean; details?: unknown}};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {cache: 'no-store', ...init});
    let data: unknown = null;
    try {
        data = await response.json();
    } catch {
        // Non-JSON error body: fall through to the status check.
    }
    if (response.ok) return data as T;
    const envelope = (data ?? {}) as Envelope;
    const error = envelope.error ?? {};
    throw new V2ApiError(response.status, error.code ?? 'UNKNOWN', error.message ?? `请求失败（${response.status}）`, {
        requestId: error.request_id,
        retryable: error.retryable,
        details: error.details,
    });
}

export function v2get<T>(path: string): Promise<T> {
    return request<T>(path);
}

export function v2post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `neo2-${crypto.randomUUID()}`,
        },
        body: JSON.stringify(body ?? {}),
    });
}

/** Appends the workspace scope to a v2 path. */
export function withBusiness(path: string, businessId: string): string {
    if (!businessId) return path;
    const joiner = path.includes('?') ? '&' : '?';
    return `${path}${joiner}businessId=${encodeURIComponent(businessId)}`;
}

export function errorMessage(error: unknown): string {
    if (error instanceof V2ApiError) {
        const detail = error.code ? `（${error.code}）` : '';
        return `${error.message}${detail}`;
    }
    return (error as Error)?.message || '请求失败';
}
