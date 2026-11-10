export interface ObjectBucket {
    put(key: string, value: Uint8Array): Promise<unknown>;
    get(key: string): Promise<{
        arrayBuffer(): Promise<ArrayBuffer>;
        size?:number;
        body?:ReadableStream<Uint8Array>;
    } | null>;
}
export type Runtime = {
    disableAutomaticPatrol?: boolean;
    automaticMonitorBusinesses?: string[];
    knowledgeMonitorEnabled?: boolean;
    agentExecutionMode?: 'live'|'offline'|'disabled';
    offlineAgentInteractive?: boolean;
    manualAgentBusinesses?: string[];
    manualMarketBusinesses?: string[];
    NEO_OFFLINE_AGENT_URL?: string;
    isolatedAgentBusinesses?: string[];
    NEO_CONFIG_ENCRYPTION_KEY?: string;
    NEO_CONTROL_URL?: string;
    NEO_AGENT_URL?: string;
    NEO_SERVICE_TOKEN?: string;
    DB?: D1Database;
    RAW_FILES?: ObjectBucket;
    local?: {
        enabled: boolean;
        development: boolean;
        userId: string;
    };
    trustSitesIdentity?: boolean;
};
export function statement(db: D1Database, sql: string, ...values: unknown[]) { return db.prepare(sql).bind(...values); }
export async function all<T>(db: D1Database, sql: string, ...values: unknown[]) { return (await statement(db, sql, ...values).all<T>()).results; }
export async function first<T>(db: D1Database, sql: string, ...values: unknown[]) { return statement(db, sql, ...values).first<T>(); }
// A single JSON parameter avoids D1's 100-bind-parameter limit.
export async function writeJsonChunks(db: D1Database, rows: unknown[], sql: string, extra: unknown[] = []) {
    let group: unknown[] = [];
    let bytes = 0;
    for (const row of rows) {
        const size = new TextEncoder().encode(JSON.stringify(row)).length;
        if (group.length && (group.length >= 100 || bytes + size > 128 * 1024)) {
            await statement(db, sql, JSON.stringify(group), ...extra).run();
            group = [];
            bytes = 0;
        }
        group.push(row);
        bytes += size;
    }
    if (group.length)
        await statement(db, sql, JSON.stringify(group), ...extra).run();
}
