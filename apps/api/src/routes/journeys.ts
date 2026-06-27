import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { IngestEvent, Profile } from "@cdp-us/contracts";
import { runJourney, type JourneyContext, type JourneyDefinition, type JourneyExecutor, type JourneyPredicate, type JourneyStep } from "@cdp-us/journeys";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

export type JourneyDeps = Readonly<{ executors?: Readonly<Record<string, JourneyExecutor>>; loadContext?: (tenantId: string, body: JourneyBody) => JourneyContext | Promise<JourneyContext> }>;
export type JourneyBody = z.infer<typeof bodySchema>;

const conditionSchema = z.object({ path: z.string().min(1), equals: z.unknown().optional(), exists: z.boolean().optional() }).optional();
const stepSchema = z.discriminatedUnion("type", [
  z.object({ key: z.string().min(1), type: z.literal("enter"), when: conditionSchema, next: z.string().min(1).optional() }),
  z.object({ key: z.string().min(1), type: z.literal("wait"), delaySeconds: z.number().int().nonnegative(), next: z.string().min(1).optional() }),
  z.object({ key: z.string().min(1), type: z.literal("branch"), when: conditionSchema, trueStep: z.string().min(1).optional(), falseStep: z.string().min(1).optional() }),
  z.object({ key: z.string().min(1), type: z.literal("action"), executor: z.string().min(1), params: z.record(z.unknown()).default({}), next: z.string().min(1).optional() }),
  z.object({ key: z.string().min(1), type: z.literal("exit") }),
]);
const profileSchema = z.object({ id: z.string().min(1).default("route-profile"), tenantId: z.string().min(1).optional(), anonymousId: z.string().optional(), email: z.string().optional(), firmographics: z.record(z.unknown()).default({}), intent: z.record(z.unknown()).default({}), traits: z.record(z.unknown()).default({}), createdAt: z.string().default("2026-01-01T00:00:00.000Z"), updatedAt: z.string().default("2026-01-01T00:00:00.000Z") });
const bodySchema = z.object({ definition: z.object({ key: z.string().min(1), steps: z.array(stepSchema).min(1).max(100) }), context: z.object({ profile: profileSchema.optional(), events: z.array(z.unknown()).default([]) }).optional(), maxSteps: z.number().int().positive().max(500).optional() });

/** @example registerJourneys(app, tenants, tokens, { executors }); // POST /v1/tenants/t_1/journeys/run */
export function registerJourneys(app: FastifyInstance, tenantStore: TenantStore, tokenStore: TokenStore, deps: JourneyDeps = {}): void {
  app.post("/v1/tenants/:tenantId/journeys/run", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")) return reply.code(403).send({ error: "forbidden" });

    const tenant = await tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });
    if (!tenant.enabledModules.includes("automation")) return reply.code(403).send({ error: "module_not_enabled", module: "automation" });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_definition", issues: parsed.error.issues });
    const context = await (deps.loadContext?.(tenantId, parsed.data) ?? defaultContext(tenantId, parsed.data));
    const run = await runJourney(toDefinition(parsed.data.definition), context, deps.executors ?? {}, { maxSteps: parsed.data.maxSteps });
    return reply.send({ ok: true, tenantId, journeyKey: run.journeyKey, status: run.status, results: run.results });
  });
}

function toDefinition(input: JourneyBody["definition"]): JourneyDefinition {
  return { key: input.key, steps: input.steps.map(toStep) };
}

function toStep(step: JourneyBody["definition"]["steps"][number]): JourneyStep {
  if (step.type === "enter") return { key: step.key, type: "enter", when: predicate(step.when), next: step.next };
  if (step.type === "branch") return { key: step.key, type: "branch", when: predicate(step.when), trueStep: step.trueStep, falseStep: step.falseStep };
  return step;
}

function predicate(condition: z.infer<typeof conditionSchema>): JourneyPredicate {
  return (context) => {
    if (!condition) return true;
    const value = readPath(context, condition.path);
    if (condition.exists !== undefined) return condition.exists ? value !== undefined : value === undefined;
    return value === condition.equals;
  };
}

function defaultContext(tenantId: string, body: JourneyBody): JourneyContext {
  const profile = body.context?.profile;
  return { profile: { id: "route-profile", firmographics: {}, intent: {}, traits: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...profile, tenantId: profile?.tenantId ?? tenantId } as Profile, events: (body.context?.events as readonly IngestEvent[] | undefined) ?? [] };
}

function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
