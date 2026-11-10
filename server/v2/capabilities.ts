import type {ActorContext} from './auth.ts';
import type {Availability} from '../../lib/store-v2/contracts/availability.ts';

export type ActionCapability = {
    action_template_id: string;
    allowed: boolean;
    reason_codes: string[];
};

export type CapabilityPlan = {
    workspace_id: string;
    actor_id: string;
    role: ActorContext['role'];
    stores: {status: 'available' | 'not_supported'; items: Array<{store_id: string; name: string; cost_visible: boolean}>; reason_codes: string[]};
    actions: ActionCapability[];
    cost_fields: {status: 'available' | 'blocked'; reason_codes: string[]};
    limitations: string[];
};

/** Store action templates ACT01–ACT09 from product chapter 14.2. */
export const ACTION_TEMPLATES = ['ACT01', 'ACT02', 'ACT03', 'ACT04', 'ACT05', 'ACT06', 'ACT07', 'ACT08', 'ACT09'] as const;

/**
 * Plans what this actor may do in this workspace.
 * Action allowance currently follows the write gate only; per-template preconditions belong to DEV05/08.
 */
export function capabilityPlan(actor: ActorContext): CapabilityPlan {
    const canWrite = actor.permissions.canWrite;
    return {
        workspace_id: actor.workspaceId,
        actor_id: actor.actorId,
        role: actor.role,
        stores: {status: 'not_supported', items: [], reason_codes: ['STORE_DIRECTORY_NOT_IMPLEMENTED']},
        actions: ACTION_TEMPLATES.map((action_template_id) => ({
            action_template_id,
            allowed: canWrite,
            reason_codes: canWrite ? [] : ['READ_ONLY'],
        })),
        cost_fields: actor.permissions.costVisible
            ? {status: 'available', reason_codes: []}
            : {status: 'blocked', reason_codes: ['ROLE_COST_FIELDS_BLOCKED']},
        limitations: [
            '门店目录与字段级不可见策略在 DEV03 导入接入后生效；当前不返回门店列表，不伪造门店。',
            '审批人角色分离（区域/总部）尚未建模；当前仅 admin 具备审批能力。',
            '动作模板只按写入权限放行，模板前置条件与证据要求在 DEV05/DEV08 实现。',
        ],
    };
}

export function capabilityAvailability(plan: CapabilityPlan): Availability {
    return {
        status: plan.stores.status === 'not_supported' ? 'partial' : 'available',
        reason_codes: plan.stores.status === 'not_supported' ? ['STORE_DIRECTORY_NOT_IMPLEMENTED'] : [],
        coverage: null,
        missing_fields: plan.stores.status === 'not_supported' ? ['stores'] : [],
    };
}
