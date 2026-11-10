import {context as workspaceContext, type Context} from '../auth.ts';
import type {Runtime} from '../store.ts';
import {StoreV2Error} from '../../lib/store-v2/contracts/errors.ts';

export type StoreRole = 'admin' | 'importer' | 'reader';

export type ActorPermissions = {
    canWrite: boolean;
    canImport: boolean;
    canApprove: boolean;
    costVisible: boolean;
};

export type ActorContext = {
    actorId: string;
    workspaceId: string;
    workspaceName: string;
    role: StoreRole;
    roleSource: 'server_membership';
    permissions: ActorPermissions;
};

/**
 * Role → permissions is server-owned policy. Client headers, query or body never supply role or tenant.
 * Approval separation for regional/HQ roles is not modelled yet; only admin may approve.
 */
export const ROLE_PERMISSIONS: Record<StoreRole, ActorPermissions> = {
    admin: {canWrite: true, canImport: true, canApprove: true, costVisible: true},
    importer: {canWrite: true, canImport: true, canApprove: false, costVisible: false},
    reader: {canWrite: false, canImport: false, canApprove: false, costVisible: false},
};

/**
 * Resolves the trusted workspace membership through the existing session identity.
 * Fails closed: no local test identity outside development, no implicit workspace or role.
 */
export async function resolveActorContext(request: Request, runtime: Runtime, requestedWorkspaceId?: string | null): Promise<ActorContext> {
    const workspace: Context = await workspaceContext(request, runtime, requestedWorkspaceId ?? null);
    const role = workspace.role as StoreRole;
    if (!Object.hasOwn(ROLE_PERMISSIONS, role)) throw new StoreV2Error('NO_BUSINESS_ACCESS', '无企业访问权限');
    return {
        actorId: workspace.userId,
        workspaceId: workspace.businessId,
        workspaceName: workspace.businessName,
        role,
        roleSource: 'server_membership',
        permissions: {...ROLE_PERMISSIONS[role]},
    };
}

/** Foreign workspace objects are indistinguishable from missing ones (404, no existence leak). */
export function assertVisible(actor: ActorContext, object: {workspaceId: string; objectId?: string}): void {
    if (object.workspaceId !== actor.workspaceId) {
        throw new StoreV2Error('NOT_VISIBLE', '对象不存在或不可见');
    }
}

/** Server-side write gate: membership role and same-origin, in that order. */
export function requireActorWrite(request: Request, actor: ActorContext): void {
    if (!actor.permissions.canWrite) throw new StoreV2Error('READ_ONLY', '只读成员不能写入');
    const origin = request.headers.get('origin');
    const site = request.headers.get('sec-fetch-site');
    if (origin !== new URL(request.url).origin || site === 'cross-site' || site === 'same-site') {
        throw new StoreV2Error('ORIGIN_REJECTED', '写入请求必须来自同一站点');
    }
}

export function requireCapability(actor: ActorContext, capability: keyof ActorPermissions): void {
    if (!actor.permissions[capability]) throw new StoreV2Error('READ_ONLY', '当前成员无此操作权限', {capability});
}
