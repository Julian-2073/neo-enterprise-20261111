import {ApiError, json} from '../errors.ts';
import type {Runtime} from '../store.ts';
import {StoreV2Error, v2assert} from '../../lib/store-v2/contracts/errors.ts';
import {capabilityAvailability, capabilityPlan} from './capabilities.ts';
import {requireActorWrite, resolveActorContext} from './auth.ts';
import {stageStoreInput, confirmStoreImport} from './import.ts';
import {detectAndCreateCase, transitionCase, listCases, getCaseDetail, reviewCase, closeCase, reopenCase, listReviews} from './cases.ts';
import {runAnalysis, type AnalysisWorkspace} from './analysis.ts';
import {createPlanRevision, submitPlan, decidePlan, listPlans} from './plans.ts';
import {createTask, transitionTask, listTasks} from './tasks.ts';
import {investigateCase} from './investigation.ts';

const PREFIX = '/api/v2/store';

function requestId(request: Request): string {
    return request.headers.get('x-request-id')?.slice(0, 160) || crypto.randomUUID();
}

function errorResponse(error: unknown, id: string): Response {
    if (error instanceof StoreV2Error) {
        return json({
            error: {
                request_id: id,
                code: error.code,
                message: error.message,
                retryable: error.retryable,
                ...(error.details ? {details: error.details} : {}),
            },
        }, error.status);
    }
    if (error instanceof ApiError) {
        // Reuse the v1 session/workspace assertion codes without leaking foreign object details.
        return json({error: {request_id: id, code: error.code, message: error.message, retryable: false}}, error.status);
    }
    console.error('NEO store v2 failed', error instanceof Error ? error.message : 'unknown');
    return json({error: {request_id: id, code: 'STORAGE_UNAVAILABLE', message: '处理或存储暂时不可用，请先回读状态再重试', retryable: true}}, 503);
}

/**
 * `/api/v2/store` entry point.
 * DEV02 implements identity, capability planning and the error/response envelope.
 * Every other documented v2 operation answers 501 with its owning stage — never sample data.
 */
export async function handleStoreV2(request: Request, runtime: Runtime): Promise<Response> {
    const id = requestId(request);
    try {
        const url = new URL(request.url);
        if (!url.pathname.startsWith(PREFIX)) throw new StoreV2Error('NOT_FOUND', '接口不存在');
        const segments = url.pathname.slice(PREFIX.length).split('/').filter(Boolean).map(decodeURIComponent);
        const [resource, ...rest] = segments;
        if (!resource) throw new StoreV2Error('NOT_FOUND', '接口不存在');
        if (request.method !== 'GET' && request.method !== 'POST') {
            throw new StoreV2Error('METHOD_NOT_ALLOWED', '仅支持 GET 与 POST');
        }

        const actor = await resolveActorContext(request, runtime, url.searchParams.get('businessId'));
        if (request.method === 'POST') {
            requireActorWrite(request, actor);
            const idem = request.headers.get('idempotency-key');
            v2assert(idem && idem.length >= 8 && idem.length <= 200,
                'VERSION_REQUIRED', '写入须携带 8–200 字符的 Idempotency-Key');
        }

        const body = request.method === 'POST'
            ? await request.json().catch(() => null)
            : null;

        if (resource === 'capabilities' && rest.length === 0 && request.method === 'GET') {
            if (url.searchParams.has('store_id')) {
                throw new StoreV2Error('NOT_IMPLEMENTED', '门店目录尚未接入，暂不能按门店过滤能力', {stage: 'DEV03', field: 'store_id'});
            }
            const plan = capabilityPlan(actor);
            return json({
                request_id: id,
                workspace_id: actor.workspaceId,
                workspace_name: actor.workspaceName,
                actor_id: actor.actorId,
                role: actor.role,
                role_source: actor.roleSource,
                generated_at: new Date().toISOString(),
                availability: capabilityAvailability(plan),
                warnings: plan.limitations,
                capabilities: plan,
            });
        }
        if (resource === 'capabilities') throw new StoreV2Error('NOT_FOUND', '接口不存在');

        if (resource === 'imports' && request.method === 'POST') {
            const idempotencyKey = request.headers.get('idempotency-key');
            v2assert(idempotencyKey && idempotencyKey.length >= 8 && idempotencyKey.length <= 200,
                'VERSION_REQUIRED', '写入须携带 8–200 字符的 Idempotency-Key');
            if (rest.length === 0) {
                const preview = await stageStoreInput(request, runtime, actor, body);
                return json({request_id: id, ...preview});
            }
            if (rest.length === 2 && rest[1] === 'confirm') {
                const importId = rest[0];
                const revision = Number(body?.validation_revision);
                v2assert(Number.isSafeInteger(revision), 'VERSION_REQUIRED', '须提供整数 validation_revision');
                const result = await confirmStoreImport(runtime, actor, importId, revision);
                return json({request_id: id, ...result});
            }
            throw new StoreV2Error('NOT_FOUND', '接口不存在');
        }

        if (resource === 'signals' && rest.length === 1 && rest[0] === 'detect' && request.method === 'POST') {
            v2assert(body && typeof body.snapshot_id === 'string', 'INVALID_COMMAND', '须提供 snapshot_id');
            const result = await detectAndCreateCase(request, runtime, actor, body.snapshot_id);
            return json({request_id: id, ...result});
        }

        if (resource === 'cases' && request.method === 'GET') {
            if (rest.length === 0) {
                const state = url.searchParams.get('state') ?? undefined;
                const limitParam = url.searchParams.get('limit');
                const limit = limitParam ? Number(limitParam) : undefined;
                v2assert(limit === undefined || (Number.isSafeInteger(limit) && limit > 0), 'INVALID_COMMAND', 'limit 须为正整数');
                const rows = await listCases(runtime, actor, {state, limit});
                return json({request_id: id, cases: rows, total: rows.length});
            }
            if (rest.length === 1) {
                const detail = await getCaseDetail(runtime, actor, rest[0]);
                return json({request_id: id, ...detail});
            }
            if (rest.length === 2 && rest[1] === 'plans') {
                const plans = await listPlans(runtime, actor, rest[0]);
                return json({request_id: id, plans});
            }
            if (rest.length === 2 && rest[1] === 'tasks') {
                const tasks = await listTasks(runtime, actor, rest[0]);
                return json({request_id: id, tasks});
            }
            if (rest.length === 2 && rest[1] === 'reviews') {
                const reviews = await listReviews(runtime, actor, rest[0]);
                return json({request_id: id, reviews});
            }
            throw new StoreV2Error('NOT_FOUND', '接口不存在');
        }

        if (resource === 'cases' && rest.length === 2 && rest[1] === 'transition' && request.method === 'POST') {
            v2assert(body && typeof body.to_state === 'string', 'INVALID_COMMAND', '须提供 to_state');
            v2assert(Number.isSafeInteger(body?.expected_version), 'VERSION_REQUIRED', '须提供整数 expected_version');
            v2assert(typeof body?.reason === 'string' && body.reason.trim(), 'INVALID_COMMAND', '须提供 reason');
            const updated = await transitionCase(request, runtime, actor, rest[0], body.to_state, body.expected_version, body.reason);
            return json({request_id: id, ...updated});
        }

        if (resource === 'cases' && rest.length === 2 && rest[1] === 'plans' && request.method === 'POST') {
            v2assert(body && typeof body.title === 'string' && body.title.trim(), 'INVALID_COMMAND', '须提供 title');
            v2assert(body.payload !== null && typeof body.payload === 'object', 'INVALID_COMMAND', 'payload 须为对象');
            const plan = await createPlanRevision(request, runtime, actor, rest[0], body.title, body.payload);
            return json({request_id: id, ...plan});
        }
        if (resource === 'cases' && rest.length === 2 && rest[1] === 'investigate' && request.method === 'POST') {
            const result = await investigateCase(request, runtime, actor, rest[0]);
            return json({request_id: id, ...result});
        }
        if (resource === 'cases' && rest.length === 2 && rest[1] === 'review' && request.method === 'POST') {
            v2assert(Number.isSafeInteger(body?.expected_version), 'VERSION_REQUIRED', '须提供整数 expected_version');
            v2assert(typeof body?.conclusion === 'string' && body.conclusion.trim(), 'INVALID_COMMAND', '须提供 conclusion');
            v2assert(Array.isArray(body?.candidate_learnings), 'INVALID_COMMAND', 'candidate_learnings 须为数组');
            const observed = typeof body?.observed_effect === 'string' ? body.observed_effect : null;
            const result = await reviewCase(request, runtime, actor, rest[0], body.expected_version, body.conclusion, body.candidate_learnings, observed);
            return json({request_id: id, ...result});
        }
        if (resource === 'cases' && rest.length === 2 && rest[1] === 'close' && request.method === 'POST') {
            v2assert(Number.isSafeInteger(body?.expected_version), 'VERSION_REQUIRED', '须提供整数 expected_version');
            v2assert(typeof body?.reason === 'string' && body.reason.trim(), 'INVALID_COMMAND', '须提供 reason');
            const result = await closeCase(request, runtime, actor, rest[0], body.expected_version, body.reason);
            return json({request_id: id, ...result});
        }
        if (resource === 'cases' && rest.length === 2 && rest[1] === 'reopen' && request.method === 'POST') {
            v2assert(Number.isSafeInteger(body?.expected_version), 'VERSION_REQUIRED', '须提供整数 expected_version');
            v2assert(typeof body?.reason === 'string' && body.reason.trim(), 'INVALID_COMMAND', '须提供 reason');
            const result = await reopenCase(request, runtime, actor, rest[0], body.expected_version, body.reason);
            return json({request_id: id, ...result});
        }

        if (resource === 'plans' && request.method === 'POST') {
            if (rest.length === 2 && rest[1] === 'submit') {
                v2assert(Number.isSafeInteger(body?.expected_version), 'VERSION_REQUIRED', '须提供整数 expected_version');
                const plan = await submitPlan(request, runtime, actor, rest[0], body.expected_version);
                return json({request_id: id, ...plan});
            }
            if (rest.length === 1 && rest[0] === 'decide') {
                const plan = await decidePlan(request, runtime, actor, body);
                return json({request_id: id, ...plan});
            }
            if (rest.length === 2 && rest[1] === 'tasks') {
                v2assert(body && typeof body.title === 'string' && body.title.trim(), 'INVALID_COMMAND', '须提供 title');
                v2assert(typeof body.action_type === 'string' && body.action_type.trim(), 'INVALID_COMMAND', '须提供 action_type');
                const task = await createTask(request, runtime, actor, rest[0], body.title, body.action_type);
                return json({request_id: id, ...task});
            }
            throw new StoreV2Error('NOT_FOUND', '接口不存在');
        }

        if (resource === 'tasks' && rest.length === 2 && rest[1] === 'commands' && request.method === 'POST') {
            const task = await transitionTask(request, runtime, actor, rest[0], body);
            return json({request_id: id, ...task});
        }

        if (resource === 'analysis' && rest.length === 1 && request.method === 'GET') {
            const ws = rest[0] as AnalysisWorkspace;
            v2assert(['sales-change', 'structure', 'campaign'].includes(ws), 'NOT_FOUND', '未知分析工作区');
            const snapshotId = url.searchParams.get('snapshot_id');
            v2assert(snapshotId, 'INVALID_COMMAND', '须提供 snapshot_id');
            const baselineId = url.searchParams.get('baseline_snapshot_id') ?? undefined;
            const result = await runAnalysis(runtime, actor, snapshotId, ws, baselineId);
            return json({request_id: id, ...result});
        }

        if (request.method === 'POST') {
            throw new StoreV2Error('NOT_IMPLEMENTED', '该写操作尚未实现，不生成占位结果', {stage: 'DEV03'});
        }
        throw new StoreV2Error('NOT_IMPLEMENTED', '该读取操作尚未实现，不返回示例数据', {stage: 'DEV03'});
    } catch (error) {
        return errorResponse(error, id);
    }
}
