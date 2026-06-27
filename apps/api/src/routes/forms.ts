import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ProfileService } from "@cdp-us/core-cdp";
import { consentField, submissionToEvents, validateSubmission, type FormDefinition } from "@cdp-us/forms";
import { isAllowed } from "../consent.js";
import type { TenantStore } from "../tenant.js";

export type FormsDeps = Readonly<{
  resolveForm(tenantId: string, formKey: string): Promise<FormDefinition | null> | FormDefinition | null;
}>;

const bodySchema = z.object({
  formKey: z.string().min(1),
  values: z.record(z.unknown()),
  anonymousId: z.string().min(1),
  writeKey: z.string().min(1).optional(),
});

/** @example registerForms(app, tenantStore, profileService, deps); // POST /v1/tenants/t_1/forms/submit */
export function registerForms(app: FastifyInstance, tenantStore: TenantStore, profileService: Pick<ProfileService, "applyEvent">, deps: FormsDeps): void {
  app.post("/v1/tenants/:tenantId/forms/submit", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    const writeKey = writeKeyFrom(req.headers["x-cdp-write-key"], parsed.data.writeKey);
    const tenant = writeKey ? await tenantStore.resolveTenant(writeKey) : undefined;
    if (!tenant || tenant.id !== tenantId) return reply.code(401).send({ error: "unknown_write_key" });
    const form = await deps.resolveForm(tenant.id, parsed.data.formKey);
    if (!form) return reply.code(404).send({ error: "unknown_form" });
    const validation = validateSubmission(form, parsed.data.values);
    if (!validation.ok) return reply.code(400).send({ error: "invalid_submission", issues: validation.issues });

    let accepted = 0;
    let suppressed = 0;
    const formConsent = consentAllowed(form, parsed.data.values);
    for (const event of submissionToEvents(form, parsed.data.values, parsed.data.anonymousId)) {
      if (!formConsent || !isAllowed(tenant.id, event.anonymousId, "analytics")) {
        suppressed += 1;
        continue;
      }
      await profileService.applyEvent(tenant.id, event);
      accepted += 1;
    }
    return reply.send({ ok: true, tenant: tenant.id, formKey: form.key, accepted, suppressed });
  });
}

function writeKeyFrom(header: string | string[] | number | undefined, bodyValue: string | undefined): string | undefined {
  if (typeof header === "string" && header.trim()) return header;
  return bodyValue;
}

function consentAllowed(form: FormDefinition, values: Readonly<Record<string, unknown>>): boolean {
  const field = consentField(form);
  return !field || values[field.name] === true;
}
