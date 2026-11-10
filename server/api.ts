import {handleKnowledge} from './knowledge.ts';
import {handleControlPlane,resolveControlModel} from './control-plane.ts';
import {handleWorkbenchCompat} from './workbench-compat.ts';
import {handlePlatformSettings} from './platform-settings.ts';
import {handleBusinessState} from './business-state.ts';
import {readMaterials,selectMaterial} from './materials/validation.ts';
import {businessDate} from './csv.ts';
import {handleOntology} from './ontology/api.ts';
import {handleAgents,queuePatrol,envelope} from "./agents.ts";
import {scopedEvidenceResponse,evidenceSources} from './scoped-evidence.ts';
import {analyzeEvidence} from './evidence-analysis.ts';
import Papa from "papaparse";
import { context, memberships, requireWrite } from "./auth.ts";
import {isMaterialKind} from "./materials/contracts.ts";
import { MAX_BYTES, TEMPLATE_VERSION, type DataNature, type Kind } from "./contracts.ts";
import { dateOnly } from "./csv.ts";
import { ApiError, assert, json } from "./errors.ts";
import { commitBatch, createBatch, getBatch } from "./ingestion.ts";
import { createSnapshot } from "./snapshots.ts";
import { all, first, type Runtime } from "./store.ts";
import { templates } from "./templates.ts";
async function readBytes(request: Request, max: number) {
    assert(Number(request.headers.get("content-length") ?? 0) <= max, 413, "REQUEST_SIZE", "请求体超过限制");
    const reader = request.body?.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    if (reader)
        while (true) {
            const result = await reader.read();
            if (result.done)
                break;
            size += result.value.length;
            if (size > max) {
                await reader.cancel();
                throw new ApiError(413, "REQUEST_SIZE", "请求体超过限制");
            }
            parts.push(result.value);
        }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}
async function body(request: Request) { try {
    const value = JSON.parse(new TextDecoder().decode(await readBytes(request, 16384)));
    assert(value && typeof value === "object" && !Array.isArray(value), 422, "INVALID_BODY", "需要 JSON 对象");
    return value as Record<string, unknown>;
}
catch (e) {
    if (e instanceof ApiError)
        throw e;
    throw new ApiError(422, "INVALID_BODY", "JSON 格式不正确");
} }
function text(value: unknown, name: string, required = false) { if (value === undefined || value === null || value === "") {
    assert(!required, 422, "MISSING_FIELD", `${name} 不能为空`);
    return null;
} assert(typeof value === "string" && value.trim().length > 0 && value.length <= 200, 422, "INVALID_FIELD", `${name} 须为 1–200 字符`); return value.trim(); }
function nature(value: unknown): DataNature { assert(value === "demo" || value === "business", 422, "INVALID_NATURE", "须选择 demo 或 business 数据性质"); return value; }
function day(value: unknown, name: string) { try {
    return dateOnly(text(value, name, true)!);
}
catch (e) {
    throw new ApiError(422, "INVALID_DATE", `${name}：${(e as Error).message}`);
} }
function pagination(url: URL) { const cursor = Number(url.searchParams.get("cursor") || 0), limit = Number(url.searchParams.get("limit") || 50); assert(Number.isSafeInteger(cursor) && cursor >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 100, 422, "INVALID_PAGINATION", "分页参数无效"); return { cursor, limit }; }
function csvResponse(data: unknown[], filename: string) { return new Response("\uFEFF" + Papa.unparse(data, { escapeFormulae: true }), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" } }); }
export async function handleApi(request: Request, runtime: Runtime): Promise<Response> {
    try {
        const url = new URL(request.url);
        const segments = url.pathname.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
        const [resource, id, action] = segments;
        const modelResponse=await resolveControlModel(request,runtime,segments);
        if(modelResponse)return modelResponse;
        const stateResponse=await handleBusinessState(request,runtime,segments);
        if(stateResponse)return stateResponse;
        if (resource === "businesses" && id === "current" && request.method === "GET") {
            const ctx = await context(request, runtime);
            return json({ identity: { userId: ctx.userId }, current: { id: ctx.businessId, name: ctx.businessName, role: ctx.role }, businesses: await memberships(ctx.db, ctx.userId) });
        }
        if (resource === "import-templates" && request.method === "GET") {
            await context(request, runtime);
            assert(id && Object.hasOwn(templates, id), 404, "NOT_FOUND", "模板不存在");
            const config = templates[id as Kind];
            const version=url.searchParams.get("version")||(isMaterialKind(id)?"2":TEMPLATE_VERSION);
            assert(["1","2"].includes(version)&&(!isMaterialKind(id)||version==="2"),422,"TEMPLATE_VERSION","资料模板需版本2");
            if (url.searchParams.get("format") === "csv")
                return csvResponse([[...config.required, ...config.optional]], `${id}-v${version}.csv`);
            return json({ type: id, version, referencePolicy:version==="2"?"strict":"legacy", maxRows: 1000, maxBytes: MAX_BYTES, ...config });
        }
        if (resource === "ingestion-batches" && !id && request.method === "POST") {
            const ctx = await context(request, runtime);
            requireWrite(request, ctx);
            const bytes = await readBytes(request, MAX_BYTES + 65536);
            let form: FormData;
            try {
                form = await new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type") || "" }, body: bytes }).formData();
            }
            catch {
                throw new ApiError(422, "INVALID_FORM", "须使用 multipart/form-data 上传 CSV");
            }
            const file = form.get("file");
            assert(file instanceof File && /\.csv$/i.test(file.name), 422, "INVALID_FILE", "请选择 CSV 文件");
            assert(file.size <= MAX_BYTES, 413, "FILE_SIZE", "文件最多 1 MiB");
            const kind = text(form.get("kind"), "kind", true)!;
            assert(Object.hasOwn(templates, kind), 422, "INVALID_KIND", "未知模板类型");
            const version=form.get("templateVersion");
            assert((version==="1"||version==="2")&&(!isMaterialKind(kind)||version==="2"),409,"TEMPLATE_VERSION","主数据使用版本2；事实版本1兼容或版本2严格关联");
            const start = day(form.get("coverageStart"), "coverageStart"), end = day(form.get("coverageEnd"), "coverageEnd");
            assert(start <= end, 422, "INVALID_PERIOD", "覆盖起止日顺序不正确");
            const result = await createBatch(ctx, { bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name.slice(0, 200), sourceName: text(form.get("sourceName"), "sourceName", true)!, kind: kind as Kind, templateVersion:version,nature: nature(form.get("dataNature")), start, end });
            return json(result, result.reused ? 200 : 201);
        }
        const ctx = await context(request, runtime);
        if(resource==='ontology'&&id==='platform'&&action==='snapshots'&&request.method==='POST'){
            requireWrite(request,ctx);const input=await body(request);
            const snapshot=await createSnapshot(ctx,{dataNature:nature(input.dataNature),asOf:text(input.asOf,'asOf')||businessDate(new Date().toISOString())});
            return json({snapshot,automaticInvestigation:'not_started'},201);
        }
        const knowledgeResponse=await handleKnowledge(request,ctx,segments);
        if(knowledgeResponse)return knowledgeResponse;
        const controlResponse=await handleControlPlane(request,ctx,segments);
        if(controlResponse)return controlResponse;
        const platformResponse=await handlePlatformSettings(request,ctx,segments);
        if(platformResponse)return platformResponse;
        const ontologyResponse = await handleOntology(request,ctx,segments);
        if(ontologyResponse)return ontologyResponse;
        const compatibilityResponse=await handleWorkbenchCompat(request,ctx,segments);
        if(compatibilityResponse)return compatibilityResponse;
        const agentResponse = await handleAgents(request, ctx, segments);
        if (agentResponse) return agentResponse;
        if (resource === "ingestion-batches") {
            if (!id && request.method === "GET") {
                const { cursor, limit } = pagination(url);
                const filterNature = url.searchParams.has("dataNature") ? nature(url.searchParams.get("dataNature")) : null;
                const rows = await all(ctx.db, "SELECT * FROM ingestion_batches WHERE business_id=? AND (? IS NULL OR data_nature=?) ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", ctx.businessId, filterNature, filterNature, limit + 1, cursor);
                return json({ items: rows.slice(0, limit), nextCursor: rows.length > limit ? cursor + limit : null });
            }
            const batch = await getBatch(ctx, id);
            if (action === "commit" && request.method === "POST") {
                requireWrite(request, ctx);
                const input = await body(request);
                assert(Number.isInteger(input.validationVersion), 422, "INVALID_VERSION", "validationVersion 须为整数");
                return json({ batch: await commitBatch(ctx, id, input.validationVersion as number) });
            }
            if (request.method === "GET" && action === "issues") {
                const { cursor, limit } = pagination(url);
                if (url.searchParams.get("format") === "csv") {
                    const rows = await all(ctx.db, "SELECT row_number,field,code,message,severity FROM ingestion_issues WHERE batch_id=? ORDER BY row_number,id", id);
                    return csvResponse(rows.length ? rows : [["row_number", "field", "code", "message", "severity"]], "import-issues.csv");
                }
                const rows = await all(ctx.db, "SELECT row_number,field,code,message,severity FROM ingestion_issues WHERE batch_id=? ORDER BY row_number,id LIMIT ? OFFSET ?", id, limit + 1, cursor);
                return json({ items: rows.slice(0, limit), nextCursor: rows.length > limit ? cursor + limit : null });
            }
            if (request.method === "GET" && action === "file") {
                assert(runtime.RAW_FILES, 503, "STORAGE_UNAVAILABLE", "原件存储不可用");
                const object = await runtime.RAW_FILES.get(batch.object_key);
                assert(object, 404, "FILE_NOT_FOUND", "原件不存在或尚未保存，请回读批次状态");
                return new Response(await object.arrayBuffer(), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": "attachment; filename=original.csv", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
            }
            if (request.method === "GET" && !action) {
                const { cursor, limit } = pagination(url);
                const rows = await all(ctx.db, "SELECT row_number,payload,duplicate FROM ingestion_rows WHERE batch_id=? ORDER BY row_number LIMIT ? OFFSET ?", id, limit + 1, cursor);
                return json({ batch, rows: rows.slice(0, limit), nextCursor: rows.length > limit ? cursor + limit : null });
            }
        }
        if (resource === "operating-snapshots" && request.method === "POST") {
            requireWrite(request, ctx);
            const input = await body(request);
            const snapshot = await createSnapshot(ctx, { dataNature: nature(input.dataNature), asOf: text(input.asOf, "asOf") || undefined, periodMode: input.periodMode as 'all_imported'|'window'|undefined, periodStart: text(input.periodStart, "periodStart") || undefined, periodEnd: text(input.periodEnd, "periodEnd") || undefined, productId: text(input.productId, "productId"), channel: text(input.channel, "channel"),knownAt:text(input.knownAt,"knownAt")||undefined,customerFunnel:input.customerFunnel as import("./materials/contracts.ts").CustomerFunnelRule|undefined });
            // Saving facts remains successful even if the model worker is unavailable.
            let patrol: unknown;
            try { patrol = await queuePatrol(request, ctx, snapshot); }
            catch (e) { patrol = { status: 'not_queued', error: e instanceof Error ? e.message : '主动巡检暂未启动' }; }
            return json({ snapshot, patrol }, 201);
        }
        if(resource==='operating-options'&&request.method==='GET'){
            const n=nature(url.searchParams.get('dataNature')||'demo'),snapshotId=url.searchParams.get('snapshotId');
            if(snapshotId){
                const row=await first<{payload:string}>(ctx.db,'SELECT payload FROM operating_snapshots WHERE id=? AND business_id=? AND data_nature=?',snapshotId,ctx.businessId,n);assert(row,404,'NOT_FOUND','快照不存在');
                const saved=JSON.parse(row.payload) as import('./contracts.ts').Snapshot;
                const ids=[...new Set([...(saved.domain?.products??[]).map(p=>p.id),...(saved.data.materials?.supply.products??[]).map(p=>p.productId)])];
                return json({snapshotId,asOf:saved.asOf,products:ids.map(id=>({id,name:saved.domain?.products.find(p=>p.id===id)?.name??id})),channels:[...new Set([...(saved.domain?.channels??[]).map(c=>c.id),...saved.data.channels.map(c=>c.channel)])].map(id=>({id,name:saved.domain?.channels.find(c=>c.id===id)?.name??id}))});
            }
            const asOf=dateOnly(url.searchParams.get('asOf')||businessDate(new Date().toISOString())),knownAt=new Date().toISOString();
            const masters=await readMaterials(ctx,n,knownAt);assert(masters.length<=10000,413,'MATERIAL_LIMIT','资料版本超过10000条');
            const keys=await all<{product_id:string|null;channel:string|null}>(ctx.db,"SELECT DISTINCT json_extract(f.payload,'$.product_id') product_id,json_extract(f.payload,'$.channel') channel FROM business_facts f JOIN ingestion_batches b ON b.id=f.batch_id WHERE f.business_id=? AND f.data_nature=? AND b.status='committed' AND b.committed_at<=? AND f.business_date<=? AND f.kind IN ('events','orders','inventory','expenses')",ctx.businessId,n,knownAt,asOf);
            const values=(kind:'products'|'channels',field:'product_id'|'channel')=>[...new Set([...keys.map(k=>k[field]),...masters.filter(r=>r.kind===kind).map(r=>r.fact.object_id!)])].filter((id):id is string=>!!id).map(id=>({id,row:selectMaterial(masters,kind,id,asOf)})).filter(p=>p.row||keys.some(k=>k[field]===p.id)).map(p=>({id:p.id,name:p.row?.fact.name??p.id}));
            return json({asOf,products:values('products','product_id'),channels:values('channels','channel')});
        }
        if(resource==='operating-snapshots'&&request.method==='GET'){
            const n=nature(url.searchParams.get('dataNature')||'demo');const rows=await all<{payload:string}>(ctx.db,'SELECT payload FROM operating_snapshots WHERE business_id=? AND data_nature=? ORDER BY generated_at DESC LIMIT 100',ctx.businessId,n);return json({items:rows.map(r=>{const s=JSON.parse(r.payload);return {id:s.id,generatedAt:s.generatedAt,asOf:s.asOf,periodStart:s.periodStart,periodEnd:s.periodEnd,productId:s.productId,channel:s.channel};})});
        }
        if(resource==='operating-materials'&&request.method==='GET'){
            const id=text(url.searchParams.get('snapshotId'),'snapshotId',true)!;
            const n=nature(url.searchParams.get('dataNature'));
            const row=await first<{payload:string}>(ctx.db,'SELECT payload FROM operating_snapshots WHERE id=? AND business_id=? AND data_nature=?',id,ctx.businessId,n);
            assert(row,404,'NOT_FOUND','资料版本不属于当前经营范围');const saved=JSON.parse(row.payload);
            return json({snapshotId:id,businessId:ctx.businessId,dataNature:n,knownAt:saved.knownAt??saved.generatedAt,materials:saved.data.materials??null,domain:saved.domain??null,status:saved.domain?'ready':'legacy_missing'});
        }
        if (resource === "operating-snapshot" && request.method === "GET") {
            const snapshotId = url.searchParams.get("snapshotId"), dataNature = nature(url.searchParams.get("dataNature") || "demo");
            if (snapshotId) {
                const row = await first<{
                    payload: string;
                }>(ctx.db, "SELECT payload FROM operating_snapshots WHERE id=? AND business_id=? AND data_nature=?", snapshotId, ctx.businessId, dataNature);
                assert(row, 404, "NOT_FOUND", "快照不存在");
                return json({ snapshot: JSON.parse(row.payload) });
            }
            const filters = ["asOf", "periodStart", "periodEnd", "productId", "channel"];
            const conditions = filters.map(key => `(? IS NULL OR json_extract(payload,'$.${key}')=?)`).join(" AND ");
            const values = filters.flatMap(key => [url.searchParams.get(key), url.searchParams.get(key)]);
            const row = await first<{
                payload: string;
            }>(ctx.db, `SELECT payload FROM operating_snapshots WHERE business_id=? AND data_nature=? AND ${conditions} ORDER BY generated_at DESC,id DESC LIMIT 1`, ctx.businessId, dataNature, ...values);
            return json({ snapshot: row ? JSON.parse(row.payload) : null });
        }
        if (resource === "evidence" && id && request.method === "GET") {
            if(id.startsWith('operating-plan-')||id.startsWith('operating-preview-')){const {operatingPlanEvidence}=await import('./operating-plans.ts');return json(await operatingPlanEvidence(ctx,nature(url.searchParams.get('dataNature')||'demo'),id,url.searchParams.get('snapshotId')));}
            if(id.includes(':view:')){
                const snapshotId=id.split(':view:')[0];const row=await first<{payload:string;id:string;business_id:string;data_nature:string}>(ctx.db,'SELECT payload,id,business_id,data_nature FROM operating_snapshots WHERE id=? AND business_id=? AND data_nature=?',snapshotId,ctx.businessId,nature(url.searchParams.get('dataNature')||'demo'));assert(row,404,'NOT_FOUND','证据不属于当前企业与数据范围');const s=JSON.parse(row.payload);assert(s?.id===row.id&&s.businessId===row.business_id&&s.dataNature===row.data_nature,404,'NOT_FOUND','证据所属经营记录不可信');assert(!url.searchParams.has('snapshotId')||url.searchParams.get('snapshotId')===row.id,404,'NOT_FOUND','证据与当前经营记录不同');const {cursor,limit}=pagination(url);return json(await scopedEvidenceResponse(ctx,await envelope(ctx,s),id,cursor,limit));
            }
            const record = await first<{
                payload: string; evidence_id: string; business_id: string; snapshot_id: string;
                data_nature: string; snapshot_payload: string;
            }>(ctx.db, "SELECT e.payload,e.id AS evidence_id,e.business_id,e.snapshot_id,s.data_nature,s.payload AS snapshot_payload FROM evidence_records e JOIN operating_snapshots s ON s.id=e.snapshot_id AND s.business_id=e.business_id WHERE e.id=? AND e.business_id=?", id, ctx.businessId);
            assert(record, 404, "NOT_FOUND", "证据不存在");
            const payload=JSON.parse(record.payload),owner=JSON.parse(record.snapshot_payload);
            // Columns establish ownership. Missing legacy nature is compatible; an explicit contradiction is not.
            assert(record.data_nature==='demo'||record.data_nature==='business',404,'NOT_FOUND','证据所属资料来源不可信');
            assert(owner?.id===record.snapshot_id&&owner.businessId===record.business_id&&owner.dataNature===record.data_nature,404,'NOT_FOUND','证据所属经营记录不可信');
            assert(payload?.id===record.evidence_id&&payload.businessId===record.business_id&&payload.snapshotId===record.snapshot_id,404,'NOT_FOUND','证据归属与经营记录不一致');
            assert(!Object.hasOwn(payload,'dataNature')||payload.dataNature===record.data_nature,404,'NOT_FOUND','证据不属于当前资料来源');
            assert(!url.searchParams.has('dataNature')||record.data_nature===url.searchParams.get('dataNature'),404,'NOT_FOUND','证据不属于当前资料来源');
            assert(!url.searchParams.has('snapshotId')||record.snapshot_id===url.searchParams.get('snapshotId'),404,'NOT_FOUND','证据与当前经营记录不同');
            const { cursor, limit } = pagination(url);
            const rows = await all(ctx.db, "SELECT f.id,f.kind,f.batch_id,f.row_number,f.payload,b.filename,s.name AS source_name FROM evidence_facts e JOIN business_facts f ON f.id=e.fact_id JOIN ingestion_batches b ON b.id=f.batch_id JOIN data_sources s ON s.id=f.source_id WHERE e.evidence_id=? AND f.business_id=? ORDER BY f.id LIMIT ? OFFSET ?", id, ctx.businessId, limit + 1, cursor);
            const frozen=await envelope(ctx,owner);
            const ids=(await all<{fact_id:string}>(ctx.db,'SELECT ef.fact_id FROM evidence_facts ef JOIN business_facts f ON f.id=ef.fact_id WHERE ef.evidence_id=? AND f.business_id=? AND f.data_nature=? ORDER BY ef.fact_id',id,ctx.businessId,record.data_nature)).map(x=>x.fact_id);
            return json({ evidence:{...payload,dataNature:record.data_nature,sourceCount:ids.length}, analysis:analyzeEvidence(owner,payload,frozen.facts), sources:await evidenceSources(ctx,record.data_nature,ids), records: rows.slice(0, limit), nextCursor: rows.length > limit ? cursor + limit : null });
        }
        return json({ error: { code: "NOT_FOUND", message: "接口不存在" } }, 404);
    }
    catch (e) {
        if (e instanceof ApiError)
            return json({ error: { code: e.code, message: e.message } }, e.status);
        if (e instanceof Error && /须为 YYYY|不存在的日期|非法时间/.test(e.message))
            return json({ error: { code: "INVALID_DATE", message: e.message } }, 422);
        console.error("NEO API failed", e instanceof Error ? e.message : "unknown");
        return json({ error: { code: "STORAGE_UNAVAILABLE", message: "处理或存储暂时不可用，请先回读状态再重试" } }, 503);
    }
}
