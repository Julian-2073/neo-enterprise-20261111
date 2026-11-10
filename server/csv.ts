import Papa from "papaparse";
import { MAX_BYTES, MAX_ROWS, type Fact, type Issue, type Kind, type PreparedRow } from "./contracts.ts";
import { assert, ApiError } from "./errors.ts";
import { eventStages, templates } from "./templates.ts";
import {isMaterialKind} from './materials/contracts.ts';
import {parseMaterials} from './materials/validation.ts';
export async function hash(value: string | Uint8Array): Promise<string> {
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
    const result = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, "0")).join("");
}
export function businessDate(iso: string) { return new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 10); }
export function parseTime(value: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
    if (!m)
        throw new Error("须为 YYYY-MM-DD 或 ISO 8601 时间");
    const [, y, mo, d, h = "00", mi = "00", s = "00", fraction = "", zone = "+08:00"] = m;
    const probe = new Date(Date.UTC(+y, +mo - 1, +d));
    if (+y < 1900 || +y > 9999 || probe.getUTCFullYear() !== +y || probe.getUTCMonth() !== +mo - 1 || probe.getUTCDate() !== +d || +h > 23 || +mi > 59 || +s > 59)
        throw new Error("不存在的日期或时间");
    if (zone !== "Z" && (+zone.slice(1, 3) > 14 || +zone.slice(4) > 59 || (+zone.slice(1, 3) === 14 && +zone.slice(4) !== 0)))
        throw new Error("非法时区偏移");
    const result = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${fraction ? `.${fraction}` : ""}${zone}`);
    if (!Number.isFinite(result.getTime()))
        throw new Error("非法时间");
    return result.toISOString();
}
export function dateOnly(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new Error("须为 YYYY-MM-DD");
    return businessDate(parseTime(value));
}
export async function parseFile(bytes: Uint8Array, kind: Kind, start: string, end: string) {
    assert(bytes.byteLength > 0 && bytes.byteLength <= MAX_BYTES, 413, "FILE_SIZE", "文件须为 1 MiB 以内的非空 CSV");
    let csv: string;
    try {
        csv = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
    }
    catch {
        throw new ApiError(422, "INVALID_ENCODING", "文件须使用 UTF-8 编码");
    }
    const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: "greedy" });
    assert(parsed.data.length - 1 <= MAX_ROWS, 413, "ROW_LIMIT", "每文件最多 1,000 条数据");
    if(isMaterialKind(kind))return parseMaterials(csv,kind,start,end);
    const issues: Issue[] = parsed.errors.map(e => ({ row: (e.row ?? 0) + 1, field: "", code: e.code, message: e.message, severity: "error" }));
    const headers = (parsed.data[0] ?? []).map(s => s.trim());
    const config = templates[kind];
    const error = (row: number, field: string, message: string, code = "VALIDATION") => issues.push({ row, field, message, code, severity: "error" });
    if (!parsed.data.slice(1).length)
        error(1, "", "至少需要表头和一条数据");
    if (new Set(headers).size !== headers.length)
        error(1, "", "表头不能重复");
    for (const field of config.required)
        if (!headers.includes(field))
            error(1, field, "缺少必填列");
    for (const field of headers)
        if (![...config.required, ...config.optional].includes(field))
            error(1, field, "未知列；请使用当前标准模板");
    const rows: PreparedRow[] = [];
    if (issues.length)
        return { rows, issues, rowCount: Math.max(0, parsed.data.length - 1) };
    for (let i = 1; i < parsed.data.length; i++) {
        const cells = parsed.data[i];
        const row = i + 1;
        if (cells.length !== headers.length) {
            error(row, "", "字段数量与表头不一致");
            continue;
        }
        const input = Object.fromEntries(headers.map((key, j) => [key, cells[j].trim()]));
        const before = issues.length;
        const str = (field: string, required = false): string | null => {
            const v = input[field] || null;
            if (required && !v)
                error(row, field, "不能为空");
            if (v && v.length > 200)
                error(row, field, "最多 200 字符");
            return v;
        };
        const integer = (field: string, required = false, positive = false): number | null => {
            const v = input[field];
            if (!v) {
                if (required)
                    error(row, field, "不能为空");
                return null;
            }
            if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || (positive && Number(v) === 0)) {
                error(row, field, positive ? "须为安全范围内的正整数" : "须为安全范围内的非负整数");
                return null;
            }
            return Number(v);
        };
        let occurred = "";
        try {
            occurred = parseTime(input.occurred_at);
        }
        catch (e) {
            error(row, "occurred_at", (e as Error).message);
        }
        const day = occurred ? businessDate(occurred) : "";
        if (day && (day < start || day > end))
            error(row, "occurred_at", "不在声明的覆盖日期内");
        const fact: Fact = { source_record_id: str("source_record_id", kind !== "inventory") ?? "", occurred_at: occurred, business_date: day, product_id: str("product_id", kind === "orders" || kind === "inventory"), sku_id: str("sku_id", kind === "orders" || kind === "inventory"), channel: str("channel", kind !== "inventory") };
        if(kind==='events'||kind==='orders'){
            for(const field of ['contact_id','identity_namespace','external_contact_id'] as const)if(headers.includes(field))fact[field]=str(field);
            if(kind==='events')for(const field of ['linked_order_id','linked_order_line_id'] as const)if(headers.includes(field))fact[field]=str(field);
        }
        if (kind === "events") {
            fact.event_type = input.event_type;
            fact.quantity = integer("quantity", true, true) ?? 0;
            fact.contact_id = str("contact_id");
            if (!Object.hasOwn(eventStages, fact.event_type))
                error(row, "event_type", "只接受 A1–A3、A5 行为事件");
        }
        else if (kind === "orders") {
            fact.order_id = str("order_id", true) ?? "";
            fact.order_line_id = str("order_line_id", true) ?? "";
            if (!["paid", "refund"].includes(input.entry_type))
                error(row, "entry_type", "只接受 paid 或 refund");
            fact.entry_type = input.entry_type as "paid" | "refund";
            fact.quantity = integer("quantity", true, true) ?? 0;
            fact.amount_cents = integer("amount_cents", true) ?? 0;
            fact.variable_cost_cents = integer("variable_cost_cents");
        }
        else if (kind === "inventory") {
            fact.warehouse_id = str("warehouse_id", true) ?? "";
            fact.source_record_id ||= await hash(JSON.stringify([fact.warehouse_id, fact.sku_id, fact.occurred_at]));
            fact.sellable_units = integer("sellable_units", true) ?? 0;
            fact.inventory_cost_cents = integer("inventory_cost_cents");
            fact.in_transit_units = integer("in_transit_units");
            fact.safety_units = integer("safety_units");
        }
        else
            fact.amount_cents = integer("amount_cents", true) ?? 0;
        if (before === issues.length) {
            const recordKey = kind === "inventory" ? JSON.stringify([fact.warehouse_id, fact.sku_id, fact.occurred_at]) : fact.source_record_id;
            rows.push({ row, recordKey, contentHash: await hash(JSON.stringify(fact)), fact });
        }
    }
    return { rows, issues, rowCount: parsed.data.length - 1 };
}
