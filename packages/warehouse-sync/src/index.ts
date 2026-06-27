import type { IngestEvent, Profile } from "@cdp-us/contracts";

/** @example const dialect: Dialect = "bigquery"; */
export type Dialect = "bigquery" | "snowflake" | "redshift";

/** @example const type: LogicalType = "json"; */
export type LogicalType = "string" | "number" | "bool" | "timestamp" | "json";

/** @example const column: WarehouseColumn = { name: "profile_id", type: "STRING", logicalType: "string" }; */
export type WarehouseColumn = Readonly<{ name: string; logicalType: LogicalType; type: string }>;

/** @example const row: WarehouseRow = { profile_id: "profile_1" }; */
export type WarehouseRow = Readonly<Record<string, unknown>>;

/** @example const batch: WarehouseBatch = { schemaVersion: "warehouse-sync-v1", columns: [], rows: [] }; */
export type WarehouseBatch = Readonly<{ schemaVersion: typeof SCHEMA_VERSION; columns: readonly WarehouseColumn[]; rows: readonly WarehouseRow[] }>;

/** @example const opts: WarehouseOptions = { dialect: "snowflake" }; */
export type WarehouseOptions = Readonly<{ dialect: Dialect; includeSensitive?: boolean }>;

/** @example const result: LoadResult = { ok: true, rows: 10 }; */
export type LoadResult = Readonly<{ ok: boolean; rows: number; attempts: number }>;

/** @example const loader: Loader = { load: async (batch) => ({ ok: true, rows: batch.rows.length, attempts: 1 }) }; */
export type Loader = Readonly<{ load(batch: WarehouseBatch): Promise<Omit<LoadResult, "attempts">> }>;

/** @example const version = SCHEMA_VERSION; */
export const SCHEMA_VERSION = "warehouse-sync-v1";

/** @example const type = dialectType("bigquery", "json"); */
export function dialectType(dialect: Dialect, logicalType: LogicalType): string {
  const table: Record<Dialect, Record<LogicalType, string>> = {
    bigquery: { string: "STRING", number: "FLOAT64", bool: "BOOL", timestamp: "TIMESTAMP", json: "JSON" },
    snowflake: { string: "VARCHAR", number: "FLOAT", bool: "BOOLEAN", timestamp: "TIMESTAMP_NTZ", json: "VARIANT" },
    redshift: { string: "VARCHAR", number: "DOUBLE PRECISION", bool: "BOOLEAN", timestamp: "TIMESTAMP", json: "SUPER" },
  };
  return table[dialect][logicalType];
}

/** @example const batch = buildProfileRows(profiles, { dialect: "bigquery" }); */
export function buildProfileRows(profiles: readonly Profile[], opts: WarehouseOptions): WarehouseBatch {
  const columns = profileColumns(opts);
  const rows = [...profiles].sort(byProfileId).map((profile) => profileRow(profile, opts.includeSensitive === true));
  return { schemaVersion: SCHEMA_VERSION, columns: typedColumns(columns, opts.dialect), rows };
}

/** @example const batch = buildEventRows(events, { dialect: "redshift" }); */
export function buildEventRows(events: readonly IngestEvent[], opts: WarehouseOptions): WarehouseBatch {
  const columns = eventColumns();
  const rows = events.map((event, index) => eventRow(event, index));
  return { schemaVersion: SCHEMA_VERSION, columns: typedColumns(columns, opts.dialect), rows };
}

/** @example const chunks = batch(rows, 500); */
export function batch<T>(rows: readonly T[], size = 500): readonly (readonly T[])[] {
  const safeSize = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += safeSize) chunks.push([...rows.slice(index, index + safeSize)]);
  return chunks;
}

/** @example const results = await sync([warehouseBatch], loader); */
export async function sync(batches: readonly WarehouseBatch[], loader: Loader, maxRetries = 2): Promise<readonly LoadResult[]> {
  const results: LoadResult[] = [];
  for (const item of batches) results.push(await loadWithRetry(item, loader, maxRetries));
  return results;
}

function profileColumns(opts: WarehouseOptions): readonly [string, LogicalType][] {
  const base: [string, LogicalType][] = [
    ["profile_id", "string"], ["tenant_id", "string"], ["anonymous_id", "string"], ["user_id", "string"],
    ["email", "string"], ["company", "string"], ["domain", "string"], ["intent_score", "number"], ["traits", "json"],
  ];
  return opts.includeSensitive ? [...base, ["revenue_range", "string"]] : base;
}

function eventColumns(): readonly [string, LogicalType][] {
  return [["row_id", "string"], ["type", "string"], ["anonymous_id", "string"], ["event", "string"], ["ts", "timestamp"], ["payload", "json"]];
}

function typedColumns(columns: readonly [string, LogicalType][], dialect: Dialect): readonly WarehouseColumn[] {
  return columns.map(([name, logicalType]) => ({ name, logicalType, type: dialectType(dialect, logicalType) }));
}

function profileRow(profile: Profile, includeSensitive: boolean): WarehouseRow {
  const row: Record<string, unknown> = {
    profile_id: profile.id, tenant_id: profile.tenantId, anonymous_id: profile.anonymousId, user_id: profile.userId,
    email: profile.email, company: profile.firmographics.company, domain: profile.firmographics.domain,
    intent_score: profile.intent.score, traits: profile.traits,
  };
  if (includeSensitive) row.revenue_range = profile.firmographics.revenueRange;
  return row;
}

function eventRow(event: IngestEvent, index: number): WarehouseRow {
  return {
    row_id: `${event.type}:${event.anonymousId}:${event.ts ?? index}`,
    type: event.type,
    anonymous_id: event.anonymousId,
    event: event.type === "track" ? event.event : "identify",
    ts: event.ts,
    payload: event,
  };
}

async function loadWithRetry(batchItem: WarehouseBatch, loader: Loader, maxRetries: number): Promise<LoadResult> {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const result = await loader.load(batchItem);
      return { ...result, attempts: attempt + 1 };
    } catch (error) {
      if (attempt >= maxRetries) throw error;
    }
  }
  throw new Error("Unreachable warehouse retry state.");
}

function byProfileId(left: Profile, right: Profile): number {
  return left.id.localeCompare(right.id);
}
