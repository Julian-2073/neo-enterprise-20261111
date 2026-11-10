export class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export function assert(condition: unknown, status: number, code: string, message: string): asserts condition {
    if (!condition)
        throw new ApiError(status, code, message);
}
export function json(value: unknown, status = 200) {
    return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
