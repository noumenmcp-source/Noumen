import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Profile } from "@cdp-us/contracts";
import { batch, buildProfileRows, SCHEMA_VERSION, sync, type Dialect, type Loader, type WarehouseBatch } from "@cdp-us/warehouse-sync";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

export type WarehouseProfileStore = Readonly<{ listProfiles(tenantId: string): Promise<readonly Profile[]> }>;
export type WarehouseDeps = Readonly<{ loader?: Loader; profileStore: WarehouseProfileStore }>;

const bodySchema = z.object({ dialect: z.enum(["bigquery", "snowflake", "redshift"]), includeSensitive: z.boolean().optional() });

/** @example registerWarehouseSync(app, tenants, tokens, { profileStore }); // POST /v1/tenants/t_1/warehouse/sync */
export function registerWarehouseSync(app: FastifyInstance, tenantStore: TenantStore, tokenStore: TokenStore, deps: WarehouseDeps): void {
  app.post("/v1/tenants/:tenantId/warehouse/sync", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")) return reply.code(403).send({ error: "forbidden" });

    const tenant = await tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    const profiles = await deps.profileStore.listProfiles(tenantId);
    const rows = buildProfileRows(profiles, { dialect: parsed.data.dialect as Dialect, includeSensitive: parsed.data.includeSensitive === true }).rows;
    const batches = batch(rows).map((chunk) => ({ ...buildProfileRows(profiles, { dialect: parsed.data.dialect as Dialect, includeSensitive: parsed.data.includeSensitive === true }), rows: chunk }));
    const results = await sync(batches, deps.loader ?? noopLoader);
    return reply.send({ ok: true, tenantId, dialect: parsed.data.dialect, schemaVersion: SCHEMA_VERSION, batches: batches.length, rows: rows.length, results });
  });
}

const noopLoader: Loader = {
  load: async (item: WarehouseBatch) => ({ ok: true, rows: item.rows.length }),
};
