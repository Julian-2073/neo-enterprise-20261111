import {publicationEpoch,guardPublication,validatePublishedLedger} from './business-publication.ts';
import {businessProfile} from './business-state.ts';
import { TEMPLATE_VERSION, type Batch, type DataNature, type Fact, type Issue, type Kind, type PreparedRow, type StoredFact } from "./contracts.ts";
import type { Context } from "./auth.ts";
import {isMaterialKind} from "./materials/contracts.ts";
import {checkReferences} from "./materials/validation.ts";
import { assert, ApiError } from "./errors.ts";
import { hash, parseFile } from "./csv.ts";
import { all, first, statement, writeJsonChunks } from "./store.ts";
export async function getBatch(ctx: Context, id: string) {
    const batch = await first<Batch>(ctx.db, "SELECT * FROM ingestion_batches WHERE id=? AND business_id=?", id, ctx.businessId);
    assert(batch, 404, "NOT_FOUND", "批次不存在");
    return batch;
}
export async function stagedRows(ctx: Context, id: string): Promise<PreparedRow[]> {
    const rows = await all<{
        row_number: number;
        record_key: string;
        content_hash: string;
        payload: string;
        duplicate: number;
    }>(ctx.db, "SELECT * FROM ingestion_rows WHERE batch_id=? ORDER BY row_number", id);
    return rows.map(r => ({ row: r.row_number, recordKey: r.record_key, contentHash: r.content_hash, fact: JSON.parse(r.payload), duplicate: !!r.duplicate }));
}
function issue(row: number, field: string, message: string): Issue { return { row, field, message, code: "CONFLICT", severity: "error" }; }
export async function checkDomain(ctx: Context, batch: Pick<Batch, "kind" | "source_id" | "data_nature"> & {template_version?:string}, rows: PreparedRow[]) {
    const existing = await all<StoredFact>(ctx.db, `SELECT * FROM business_facts WHERE business_id=? AND data_nature=? AND kind=? AND (
    (source_id=? AND record_key IN (SELECT json_extract(value,'$.recordKey') FROM json_each(?)))
    OR (kind IN ('inventory','roles','products','skus','channels','warehouses','customers','customer_identities','arrivals','supply_rules') AND record_key IN (SELECT json_extract(value,'$.recordKey') FROM json_each(?)))
    OR (kind='orders' AND source_id=? AND json_extract(payload,'$.order_id') IN (SELECT json_extract(value,'$.fact.order_id') FROM json_each(?))))`, ctx.businessId, batch.data_nature, batch.kind, batch.source_id, JSON.stringify(rows), JSON.stringify(rows), batch.source_id, JSON.stringify(rows));
    const issues: Issue[] = [];
    const seen = new Map<string, string>();
    for (const row of rows) {
        const matches = existing.filter(e => e.record_key === row.recordKey && (e.source_id === batch.source_id || batch.kind === "inventory" || isMaterialKind(batch.kind)));
        const previous = seen.get(row.recordKey) ?? matches[0]?.content_hash;
        row.duplicate = !!previous;
        if (previous && previous !== row.contentHash)
            issues.push(issue(row.row, "source_record_id", "相同记录键的内容不同；首版禁止覆盖"));
        seen.set(row.recordKey, row.contentHash);
    }
    if (batch.kind === "orders") {
        const ledger: Array<{
            fact: Fact;
            row: number;
        }> = existing.map(e => ({ fact: JSON.parse(e.payload), row: 0 }));
        for (const row of rows.filter(r => !r.duplicate).sort((a, b) => (a.fact.entry_type === "paid" ? 0 : 1) - (b.fact.entry_type === "paid" ? 0 : 1) || a.fact.occurred_at.localeCompare(b.fact.occurred_at))) {
            const f = row.fact;
            const sameLine = ledger.filter(p => p.fact.order_id === f.order_id && p.fact.order_line_id === f.order_line_id);
            if (f.entry_type === "paid") {
                if (sameLine.some(p => p.fact.entry_type === "paid"))
                    issues.push(issue(row.row, "order_line_id", "同订单行只能有一条支付记录"));
            }
            else {
                const paid = sameLine.find(p => p.fact.entry_type === "paid")?.fact;
                const refunds = sameLine.filter(p => p.fact.entry_type === "refund").map(p => p.fact);
                const total = (key: "amount_cents" | "quantity" | "variable_cost_cents") => refunds.reduce((s, r) => s + BigInt(r[key] ?? 0), BigInt(f[key] ?? 0));
                if (!paid || paid.occurred_at > f.occurred_at || paid.product_id !== f.product_id || paid.sku_id !== f.sku_id || paid.channel !== f.channel)
                    issues.push(issue(row.row, "order_line_id", "退款须关联同渠道/SKU且不晚于退款时间的支付记录"));
                else if (total("amount_cents") > BigInt(paid.amount_cents!) || total("quantity") > BigInt(paid.quantity!) || (f.variable_cost_cents !== null && paid.variable_cost_cents !== null && total("variable_cost_cents") > BigInt(paid.variable_cost_cents!)))
                    issues.push(issue(row.row, "amount_cents", "累计退款金额、数量或成本回转超过支付记录"));
            }
            ledger.push({ fact: f, row: row.row });
        }
    }
    issues.push(...await checkReferences(ctx,batch,rows));
    return issues;
}
export async function createBatch(ctx: Context, input: {
    bytes: Uint8Array;
    filename: string;
    sourceName: string;
    kind: Kind;
    nature: DataNature;
    start: string;
    end: string;
    templateVersion?: string;
}) {
    assert(!(ctx.businessId.startsWith("neo-sim-")&&input.nature!=="demo"),422,"SYNTHETIC_BUSINESS","隔离模拟企业只允许demo资料");
    assert(ctx.runtime.RAW_FILES, 503, "STORAGE_UNAVAILABLE", "原始文件存储不可用");
    const sourceKey = `${ctx.businessId}:${await hash(input.sourceName)}`;
    await statement(ctx.db, "INSERT OR IGNORE INTO data_sources(id,business_id,name) VALUES(?,?,?)", sourceKey, ctx.businessId, input.sourceName).run();
    const fileHash = await hash(input.bytes);
    const templateVersion=input.templateVersion??TEMPLATE_VERSION;
    assert(["1","2"].includes(templateVersion)&&(!isMaterialKind(input.kind)||templateVersion==="2"),422,"TEMPLATE_VERSION","资料模板需版本2");
    let prior = await first<Batch>(ctx.db, "SELECT * FROM ingestion_batches WHERE business_id=? AND source_id=? AND kind=? AND data_nature=? AND template_version=? AND file_hash=?", ctx.businessId, sourceKey, input.kind, input.nature, templateVersion, fileHash);
    if (prior && prior.status === "validating" && Date.now() - Date.parse(prior.validation_started_at || prior.created_at) > 5 * 60000) {
        await statement(ctx.db, "UPDATE ingestion_batches SET status='failed',error='校验中断，可重传原文件恢复' WHERE id=? AND status='validating' AND validation_version=?", prior.id, prior.validation_version).run();
        prior = await getBatch(ctx, prior.id);
    }
    if (prior) {
        assert(["invalid","failed"].includes(prior.status)||(prior.coverage_start === input.start && prior.coverage_end === input.end), 409, "IDEMPOTENCY_CONFLICT", "已校验或入库文件的覆盖范围不同");
        // No facts exist for invalid/failed batches. Revalidate corrections and newly
        // imported references, while ready/committed input stays immutable.
        if (!["invalid","failed"].includes(prior.status))
            return { batch: prior, reused: true };
    }
    const parsed = await parseFile(input.bytes, input.kind, input.start, input.end);
    const id = prior?.id ?? crypto.randomUUID();
    const key = `${ctx.businessId}/${id}/original.csv`;
    const createdAt = new Date().toISOString();
    if (prior) {
        const claim = await statement(ctx.db, "UPDATE ingestion_batches SET status='validating',error=NULL,validation_version=validation_version+1,validation_started_at=?,coverage_start=?,coverage_end=? WHERE id=? AND status IN ('failed','invalid') AND validation_version=?", createdAt,input.start,input.end,id,prior.validation_version).run();
        if (claim.meta.changes !== 1)
            return { batch: await getBatch(ctx, id), reused: true };
        await ctx.db.batch([statement(ctx.db, "DELETE FROM ingestion_rows WHERE batch_id=?", id), statement(ctx.db, "DELETE FROM ingestion_issues WHERE batch_id=?", id)]);
    }
    else {
        try {
            await statement(ctx.db, "INSERT INTO ingestion_batches(id,business_id,source_id,kind,data_nature,template_version,file_hash,object_key,filename,coverage_start,coverage_end,status,created_at,validation_started_at,actor_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,'validating',?,?,?)", id, ctx.businessId, sourceKey, input.kind, input.nature, templateVersion, fileHash, key, input.filename, input.start, input.end, createdAt, createdAt, ctx.userId).run();
        }
        catch (e) {
            const concurrent = await first<Batch>(ctx.db, "SELECT * FROM ingestion_batches WHERE business_id=? AND source_id=? AND kind=? AND data_nature=? AND template_version=? AND file_hash=?", ctx.businessId, sourceKey, input.kind, input.nature, templateVersion, fileHash);
            if (concurrent) {
                assert(concurrent.coverage_start === input.start && concurrent.coverage_end === input.end, 409, "IDEMPOTENCY_CONFLICT", "相同文件的覆盖范围不同");
                return { batch: concurrent, reused: true };
            }
            throw e;
        }
    }
    try {
        await ctx.runtime.RAW_FILES.put(key, input.bytes);
        const issues = [...parsed.issues, ...await checkDomain(ctx, { kind: input.kind, source_id: sourceKey, data_nature: input.nature,template_version:templateVersion }, parsed.rows)];
        await writeJsonChunks(ctx.db, parsed.rows.map(r => ({ id: `${id}:${r.row}`, batch: id, row: r.row, key: r.recordKey, hash: r.contentHash, payload: JSON.stringify(r.fact), duplicate: r.duplicate ? 1 : 0 })), "INSERT INTO ingestion_rows(id,batch_id,row_number,record_key,content_hash,payload,duplicate) SELECT json_extract(value,'$.id'),json_extract(value,'$.batch'),json_extract(value,'$.row'),json_extract(value,'$.key'),json_extract(value,'$.hash'),json_extract(value,'$.payload'),json_extract(value,'$.duplicate') FROM json_each(?)");
        await saveIssues(ctx, id, issues);
        await statement(ctx.db, "UPDATE ingestion_batches SET status=?,row_count=?,duplicate_count=? WHERE id=?", issues.some(i => i.severity === "error") ? "invalid" : "ready", parsed.rowCount, parsed.rows.filter(r => r.duplicate).length, id).run();
        return { batch: await getBatch(ctx, id), reused: false };
    }
    catch (e) {
        await statement(ctx.db, "UPDATE ingestion_batches SET status='failed',error=? WHERE id=? AND status='validating'", "校验或存储失败，请重传原文件重试", id).run();
        throw e;
    }
}
async function saveIssues(ctx: Context, id: string, issues: Issue[]) {
    await writeJsonChunks(ctx.db, issues.map((i, n) => ({ ...i, id: `${id}:issue:${n}`, batch: id })), "INSERT INTO ingestion_issues(id,batch_id,row_number,field,code,message,severity) SELECT json_extract(value,'$.id'),json_extract(value,'$.batch'),json_extract(value,'$.row'),json_extract(value,'$.field'),json_extract(value,'$.code'),json_extract(value,'$.message'),json_extract(value,'$.severity') FROM json_each(?)");
}
export async function commitBatch(ctx: Context, id: string, version: number) {
    const batch = await getBatch(ctx, id);
    if (batch.status === "committed")
        return batch;
    assert(batch.status === "ready", 409, "BATCH_NOT_READY", "批次尚未通过校验，不能提交");
    assert(version === batch.validation_version, 409, "VERSION_CONFLICT", "校验版本已变化，请重新读取批次");
    const rows = await stagedRows(ctx, id);
    const issues = await checkDomain(ctx, batch, rows);
    if (issues.length)
        throw new ApiError(409, "RECORD_CONFLICT", issues.map(i => `第 ${i.row} 行：${i.message}`).join("；"));
    const profile=await businessProfile(ctx,batch.data_nature);
    const epoch=profile&&batch.kind==='orders'?await publicationEpoch(ctx,batch.data_nature):null,time = new Date().toISOString();
    if(profile&&batch.kind==='orders')await validatePublishedLedger(ctx,batch.data_nature,JSON.parse(profile.payload),time,batch.source_id,rows.filter(r=>!r.duplicate).map(r=>({kind:'order',recordKey:r.recordKey,entityId:r.fact.sku_id??r.fact.product_id??'unassigned',businessDate:r.fact.business_date,channelId:r.fact.channel??undefined,orderId:r.fact.order_id,orderLineId:r.fact.order_line_id,entryType:r.fact.entry_type,quantity:r.fact.quantity,amountCents:r.fact.amount_cents,variableCostCents:r.fact.variable_cost_cents})),false);
    // The INSERT is an immutable publish from staging. Exact duplicates are omitted;
    // differing contents hit a UNIQUE constraint and roll back the entire batch.
    const publish = statement(ctx.db, `INSERT INTO business_facts(id,business_id,source_id,batch_id,row_number,kind,data_nature,record_key,content_hash,occurred_at,business_date,payload)
    SELECT r.id,b.business_id,b.source_id,b.id,r.row_number,b.kind,b.data_nature,r.record_key,r.content_hash,json_extract(r.payload,'$.occurred_at'),json_extract(r.payload,'$.business_date'),r.payload
    FROM ingestion_rows r JOIN ingestion_batches b ON b.id=r.batch_id
    WHERE b.id=? AND b.status='ready' AND b.validation_version=? AND r.duplicate=0
     AND NOT EXISTS(SELECT 1 FROM business_facts f WHERE f.business_id=b.business_id AND f.data_nature=b.data_nature AND f.kind=b.kind AND (f.source_id=b.source_id OR b.kind IN ('inventory','roles','products','skus','channels','warehouses','customers','customer_identities','arrivals','supply_rules')) AND f.record_key=r.record_key AND f.content_hash=r.content_hash)
    ORDER BY CASE json_extract(r.payload,'$.entry_type') WHEN 'paid' THEN 0 ELSE 1 END,r.row_number`, id, version);
    try {
        await ctx.db.batch([...(epoch==null?[]:[guardPublication(ctx,batch.data_nature,epoch)]),publish,
            statement(ctx.db,"INSERT OR IGNORE INTO neo_business_updates(id,business_id,data_nature,cause,resource_id,status,created_at) SELECT ?,b.business_id,b.data_nature,'legacy-import',b.id,'pending',? FROM ingestion_batches b WHERE b.id=? AND EXISTS(SELECT 1 FROM neo_business_profiles p WHERE p.business_id=b.business_id AND p.data_nature=b.data_nature)",`legacy-update-${id}`,time,id),
            statement(ctx.db, "UPDATE ingestion_batches SET status='committed',committed_at=?,imported_count=(SELECT COUNT(*) FROM business_facts WHERE batch_id=ingestion_batches.id),duplicate_count=row_count-(SELECT COUNT(*) FROM business_facts WHERE batch_id=ingestion_batches.id) WHERE id=? AND status='ready' AND validation_version=?", time, id, version),
            statement(ctx.db, "INSERT OR IGNORE INTO audit_events(id,business_id,actor_id,action,resource_id,created_at) SELECT ?,business_id,?,'import_committed',id,? FROM ingestion_batches WHERE id=? AND status='committed'", `${id}:committed`, ctx.userId, time, id),
        ]);
    }
    catch (e) {
        if (/UNIQUE|NOT NULL|REFUND_CONFLICT|MATERIAL_REFERENCE_CONFLICT/.test(String(e)))
            throw new ApiError(409, "RECORD_CONFLICT", "记录或退款发生并发冲突；未发布该批次，请回读并校对");
        throw e;
    }
    return getBatch(ctx, id);
}
