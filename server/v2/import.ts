// DEV03: neo.store-input.v2 staging, validation_revision confirmation, immutable snapshots.
// - Duplicate file_hash returns the existing import (not counted twice).
// - Re-staging a failed/changed import bumps validation_revision, invalidating any stale confirmation.
// - Only a 'ready' import can be confirmed; confirmation publishes an immutable snapshot.
// - Failed staging never enters neo_store_v2_facts.

import {validateStoreInput, type StoreInput} from '../../lib/store-v2/import/contract.ts';
import {StoreV2Error, v2assert} from '../../lib/store-v2/contracts/errors.ts';
import {requireActorWrite, requireCapability, type ActorContext} from './auth.ts';
import {hash} from '../csv.ts';
import {all, first, statement, writeJsonChunks, type Runtime} from '../store.ts';

const CHUNK_SIZE = 500;

export interface StoreV2ImportRow {
  import_id: string;
  workspace_id: string;
  store_id: string;
  source_system: string;
  grain: string;
  data_kind: string;
  file_hash: string;
  source_semantics_version: string;
  status: string;
  validation_revision: number;
  payload: string;
  counts: string;
  isolated_skus: string;
  warnings: string;
  errors: string;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  actor_id: string;
}

export interface ImportPreview {
  import_id: string;
  status: 'ready' | 'failed';
  validation_revision: number;
  grain: string;
  counts: Record<string, number>;
  isolated_skus: string[];
  warnings: Array<{code: string; path: string; message: string}>;
  errors: Array<{code: string; path: string; message: string}>;
  capability_preview: CapabilityPreview;
  reused: boolean;
}

export interface CapabilityPreview {
  sales_amount: {status: 'available' | 'blocked' | 'not_supported'; reason_codes: string[]};
  order_count: {status: 'available' | 'blocked' | 'not_supported'; reason_codes: string[]};
  gross_margin: {status: 'available' | 'partial' | 'blocked' | 'not_supported'; reason_codes: string[]};
  campaign_attribution: {status: 'available' | 'not_supported' | 'blocked'; reason_codes: string[]};
}

function capabilityPreview(input: StoreInput, validation: ReturnType<typeof validateStoreInput>): CapabilityPreview {
  const hasSales = validation.counts.sales > 0;
  const hasCost = input.sales.some((s) => (s as {total_cost_cents?: number | null}).total_cost_cents != null);
  return {
    sales_amount: hasSales
      ? {status: 'available', reason_codes: []}
      : {status: 'blocked', reason_codes: ['NO_SALES_ROWS']},
    order_count: input.grain === 'order_line'
      ? {status: hasSales ? 'available' : 'blocked', reason_codes: hasSales ? [] : ['NO_SALES_ROWS']}
      : {status: 'not_supported', reason_codes: ['GRAIN_NOT_SUPPORTED']},
    gross_margin: hasSales && hasCost
      ? {status: 'available', reason_codes: []}
      : hasSales
        ? {status: 'partial', reason_codes: ['COST_PARTIAL']}
        : {status: 'blocked', reason_codes: ['NO_SALES_ROWS']},
    campaign_attribution: input.grain === 'order_line'
      ? {status: input.campaign_links.length > 0 ? 'available' : 'not_supported', reason_codes: input.campaign_links.length > 0 ? [] : ['NO_CAMPAIGN_LINKS']}
      : {status: 'not_supported', reason_codes: ['GRAIN_NOT_SUPPORTED']},
  };
}

export async function stageStoreInput(
  request: Request,
  runtime: Runtime,
  actor: ActorContext,
  raw: unknown,
): Promise<ImportPreview> {
  requireActorWrite(request, actor);
  requireCapability(actor, 'canImport');
  v2assert(runtime.DB, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  const db = runtime.DB;

  const validation = validateStoreInput(raw);
  const input = validation.valid ? (raw as StoreInput) : null;
  const fileHash = await hash(JSON.stringify(raw));
  const now = new Date().toISOString();

  const existing = await first<StoreV2ImportRow>(
    db,
    'SELECT * FROM neo_store_v2_imports WHERE workspace_id=? AND file_hash=?',
    actor.workspaceId,
    fileHash,
  );

  if (existing) {
    if (existing.status === 'ready' || existing.status === 'published') {
      return toPreview(existing, true);
    }
    // Re-staging a failed/stale import: bump revision so stale confirmations fail.
    const bumped = existing.validation_revision + 1;
    await statement(
      db,
      `UPDATE neo_store_v2_imports SET status=?, validation_revision=?, payload=?, counts=?, isolated_skus=?, warnings=?, errors=?, updated_at=?
       WHERE import_id=? AND workspace_id=? AND status NOT IN ('ready','published')`,
      validation.valid ? 'ready' : 'failed',
      bumped,
      JSON.stringify(raw),
      JSON.stringify(validation.counts),
      JSON.stringify(validation.isolatedSkus),
      JSON.stringify(validation.warnings),
      JSON.stringify(validation.errors),
      now,
      existing.import_id,
      actor.workspaceId,
    ).run();
    const updated = await first<StoreV2ImportRow>(db, 'SELECT * FROM neo_store_v2_imports WHERE import_id=?', existing.import_id);
    return toPreview(updated!, false);
  }

  const importId = crypto.randomUUID();
  await statement(
    db,
    `INSERT INTO neo_store_v2_imports
     (import_id, workspace_id, store_id, source_system, grain, data_kind, file_hash, source_semantics_version,
      status, validation_revision, payload, counts, isolated_skus, warnings, errors, created_at, updated_at, actor_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    importId,
    actor.workspaceId,
    input?.store_id ?? (raw as {store_id?: string})?.store_id ?? '',
    input?.source_system ?? '',
    input?.grain ?? '',
    input?.data_kind ?? '',
    fileHash,
    input?.source_semantics_version ?? '',
    validation.valid ? 'ready' : 'failed',
    1,
    JSON.stringify(raw),
    JSON.stringify(validation.counts),
    JSON.stringify(validation.isolatedSkus),
    JSON.stringify(validation.warnings),
    JSON.stringify(validation.errors),
    now,
    now,
    actor.actorId,
  ).run();

  const row = await first<StoreV2ImportRow>(db, 'SELECT * FROM neo_store_v2_imports WHERE import_id=?', importId);
  return toPreview(row!, false);
}

export async function confirmStoreImport(
  runtime: Runtime,
  actor: ActorContext,
  importId: string,
  validationRevision: number,
): Promise<{snapshot_id: string; import_id: string}> {
  requireCapability(actor, 'canImport');
  v2assert(runtime.DB, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  const db = runtime.DB;
  const imp = await first<StoreV2ImportRow>(db, 'SELECT * FROM neo_store_v2_imports WHERE import_id=? AND workspace_id=?', importId, actor.workspaceId);
  v2assert(imp, 'NOT_VISIBLE', '导入批次不存在或不可见');
  v2assert(imp.status === 'ready', 'ILLEGAL_TRANSITION', `批次状态为 ${imp.status}，无法确认发布`);
  v2assert(imp.validation_revision === validationRevision, 'VERSION_CONFLICT', '校验版本已变化，请重新读取并确认', {expected: validationRevision, actual: imp.validation_revision});

  const input = JSON.parse(imp.payload) as StoreInput;
  const validation = validateStoreInput(input);
  v2assert(validation.valid, 'INVALID_COMMAND', '数据已失效，请重新校验');

  const snapshotId = crypto.randomUUID();
  const scopeHash = await hash(`${actor.workspaceId}:${imp.store_id}:${input.grain}:${input.source_semantics_version}:${validationRevision}`);
  const now = new Date().toISOString();

  // Build facts in memory; they are published only after the snapshot row exists (FK).
  const facts = await buildFacts(input, snapshotId, actor.workspaceId, now);

  const manifest = {
    import_id: imp.import_id,
    file_hash: imp.file_hash,
    validation_revision: validationRevision,
    source_semantics_version: input.source_semantics_version,
    grain: input.grain,
    data_kind: input.data_kind,
    currency: input.currency,
    tax_basis: input.tax_basis,
    business_timezone: input.business_timezone,
    as_of: input.as_of,
    domain_coverage: input.domain_coverage,
    counts: validation.counts,
    isolated_skus: validation.isolatedSkus,
    fact_count: facts.length,
    capability_preview: capabilityPreview(input, validation),
  };

  // Snapshot must exist before facts (FK), and the import stays 'ready' until facts are published.
  await statement(
    db,
    `INSERT INTO neo_store_v2_snapshots(snapshot_id, workspace_id, import_id, scope_hash, grain, manifest, created_at, published_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    snapshotId, actor.workspaceId, imp.import_id, scopeHash, input.grain, JSON.stringify(manifest), now, now,
  ).run();

  try {
    for (let i = 0; i < facts.length; i += CHUNK_SIZE) {
      await writeJsonChunks(
        db,
        facts.slice(i, i + CHUNK_SIZE),
        `INSERT INTO neo_store_v2_facts(fact_id, workspace_id, snapshot_id, kind, grain, business_date, source_key, content_hash, payload, created_at)
         SELECT json_extract(value,'$.fact_id'),json_extract(value,'$.workspace_id'),json_extract(value,'$.snapshot_id'),
                json_extract(value,'$.kind'),json_extract(value,'$.grain'),json_extract(value,'$.business_date'),
                json_extract(value,'$.source_key'),json_extract(value,'$.content_hash'),json_extract(value,'$.payload'),
                json_extract(value,'$.created_at')
         FROM json_each(?)`,
      );
    }
  } catch (e) {
    await statement(db, 'DELETE FROM neo_store_v2_snapshots WHERE snapshot_id=?', snapshotId).run();
    throw e;
  }

  await statement(
    db,
    `UPDATE neo_store_v2_imports SET status='published', confirmed_at=?, updated_at=?
     WHERE import_id=? AND workspace_id=? AND status='ready' AND validation_revision=?`,
    now, now, imp.import_id, actor.workspaceId, validationRevision,
  ).run();

  return {snapshot_id: snapshotId, import_id: imp.import_id};
}

async function buildFacts(input: StoreInput, snapshotId: string, workspaceId: string, now: string): Promise<Array<Record<string, unknown>>> {
  const facts: Array<Record<string, unknown>> = [];
  const push = async (kind: string, sourceKey: string, payload: unknown, businessDate: string | null) => {
    const contentHash = await hash(JSON.stringify(payload));
    facts.push({
      fact_id: `${snapshotId}:${kind}:${sourceKey}`,
      workspace_id: workspaceId,
      snapshot_id: snapshotId,
      kind,
      grain: input.grain,
      business_date: businessDate,
      source_key: sourceKey,
      content_hash: contentHash,
      payload: JSON.stringify(payload),
      created_at: now,
    });
  };

  for (const sku of input.skus) {
    await push('sku', sku.source_sku_id, sku, null);
  }
  for (const sale of input.sales) {
    const s = sale as unknown as Record<string, unknown>;
    const key = input.grain === 'order_line'
      ? `${s.source_order_id}:${s.source_line_id}`
      : `${s.business_date}:${s.source_sku_id}:${s.source_record_id}`;
    await push('sales', key, sale, input.grain === 'order_line' ? String(s.occurred_at).slice(0, 10) : String(s.business_date));
  }
  for (const ret of input.returns) {
    await push('return', ret.source_refund_id, ret, String(ret.occurred_at).slice(0, 10));
  }
  for (const st of input.stock) {
    await push('stock', `${st.source_sku_id}:${st.observed_at}`, st, String(st.observed_at).slice(0, 10));
  }
  for (const camp of input.campaigns) {
    await push('campaign', camp.campaign_id, camp, null);
  }
  for (const link of input.campaign_links) {
    await push('campaign_link', `${link.campaign_id}:${link.source_order_id}:${link.source_line_id}`, link, null);
  }
  return facts;
}

function toPreview(row: StoreV2ImportRow, reused: boolean): ImportPreview {
  const counts = JSON.parse(row.counts);
  const input = JSON.parse(row.payload) as StoreInput;
  const validation = validateStoreInput(input);
  return {
    import_id: row.import_id,
    status: row.status as 'ready' | 'failed',
    validation_revision: row.validation_revision,
    grain: row.grain,
    counts,
    isolated_skus: JSON.parse(row.isolated_skus),
    warnings: JSON.parse(row.warnings),
    errors: JSON.parse(row.errors),
    capability_preview: capabilityPreview(input, validation),
    reused,
  };
}
