import type { Role } from "./contracts.ts";
import { assert } from "./errors.ts";
import { all, first, type Runtime } from "./store.ts";
export type Context = {
    db: D1Database;
    userId: string;
    businessId: string;
    businessName: string;
    role: Role;
    runtime: Runtime;
};
export async function identity(request: Request, runtime: Runtime): Promise<string> {
    if (runtime.local?.enabled) {
        assert(runtime.local.development, 503, "LOCAL_AUTH_FORBIDDEN", "生产环境禁止测试身份");
        assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname), 401, "LOCAL_ONLY", "测试身份仅限本机访问");
        return runtime.local.userId;
    }
    assert(runtime.trustSitesIdentity, 401, "AUTH_REQUIRED", "请先登录；当前环境未配置可信身份入口");
    const id = request.headers.get("oai-authenticated-user-id");
    assert(id && request.headers.get("oai-authenticated-user-email"), 401, "AUTH_REQUIRED", "请先登录");
    return id;
}
export async function memberships(db: D1Database, userId: string) {
    return all<{
        id: string;
        name: string;
        role: Role;
    }>(db, "SELECT b.id,b.name,m.role FROM businesses b JOIN business_members m ON m.business_id=b.id WHERE m.user_id=? ORDER BY b.id", userId);
}
export async function context(request: Request, runtime: Runtime, businessId?: string | null): Promise<Context> {
    assert(runtime.DB, 503, "STORAGE_UNAVAILABLE", "D1 数据库不可用");
    const userId = await identity(request, runtime);
    const selected = businessId || new URL(request.url).searchParams.get("businessId");
    const member = selected
        ? await first<{
            id: string;
            name: string;
            role: Role;
        }>(runtime.DB, "SELECT b.id,b.name,m.role FROM businesses b JOIN business_members m ON m.business_id=b.id WHERE b.id=? AND m.user_id=?", selected, userId)
        : (await memberships(runtime.DB, userId))[0];
    assert(member, 403, "NO_BUSINESS_ACCESS", "无企业访问权限");
    return { db: runtime.DB, runtime, userId, businessId: member.id, businessName: member.name, role: member.role };
}
export function requireWrite(request: Request, ctx: Context) {
    assert(ctx.role !== "reader", 403, "READ_ONLY", "只读成员不能写入");
    assert(request.headers.get("origin") === new URL(request.url).origin && !["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? ""), 403, "ORIGIN_REJECTED", "写入请求必须来自同一站点");
}
