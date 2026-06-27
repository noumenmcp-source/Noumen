import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dispatch, type Channel, type ConsentCheck, type Sender } from "@cdp-us/notifications";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

export type NotificationsDeps = Readonly<{
  tenantStore: TenantStore;
  tokenStore: TokenStore;
  senders: Partial<Record<Channel, Sender>>;
  consentCheck?: (tenantId: string, channel: Channel) => boolean | Promise<boolean>;
}>;

const channelSchema = z.enum(["in_app", "email", "slack", "sms"]);
const bodySchema = z.object({
  notification: z.object({ template: z.string().min(1), subjectTemplate: z.string().min(1).optional(), data: z.record(z.unknown()), channels: z.array(channelSchema).min(1) }),
  preferences: z.object({ allowed: z.array(channelSchema) }),
});

/** @example registerNotifications(app, { tenantStore, tokenStore, senders }); // POST /v1/tenants/t_1/notifications/send */
export function registerNotifications(app: FastifyInstance, deps: NotificationsDeps): void {
  app.post("/v1/tenants/:tenantId/notifications/send", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const principal = await authenticate(req, deps.tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")) return reply.code(403).send({ error: "forbidden" });
    const tenant = await deps.tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    const consentCheck: ConsentCheck = (channel) => channel !== "sms" || (deps.consentCheck?.(tenantId, channel) ?? false);
    const results = await dispatch(parsed.data.notification, parsed.data.preferences, deps.senders, { consentCheck });
    return reply.send({ ok: true, tenantId, results });
  });
}
