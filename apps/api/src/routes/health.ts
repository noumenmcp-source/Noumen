import type { FastifyInstance } from "fastify";

export const counters = { received: 0, stored: 0, suppressed: 0, failed: 0 };

export function resetCounters(): void {
  counters.received = 0;
  counters.stored = 0;
  counters.suppressed = 0;
  counters.failed = 0;
}

/** Readiness probe: ok=false fails the orchestrator's readiness check. */
export type ReadinessProbe = () => Promise<{ ok: boolean; checks: Record<string, "ok" | "fail"> }>;

export function registerHealth(app: FastifyInstance, opts: { readiness?: ReadinessProbe } = {}): void {
  app.get("/v1/health", async () => ({
    status: "ok",
    region: "us",
    counters,
  }));

  // Liveness: the process is up and serving (always 200 unless wedged).
  app.get("/v1/live", async () => ({ status: "ok" }));

  // Readiness: dependencies (e.g. the database) are reachable. 503 when not, so
  // orchestrators stop routing traffic to an instance that can't serve.
  app.get("/v1/ready", async (_req, reply) => {
    const result = opts.readiness ? await opts.readiness() : { ok: true, checks: {} };
    return reply.code(result.ok ? 200 : 503).send({ status: result.ok ? "ready" : "unready", checks: result.checks });
  });
}
