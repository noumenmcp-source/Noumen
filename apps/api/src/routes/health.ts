import type { FastifyInstance } from "fastify";

export const counters = { received: 0, stored: 0, suppressed: 0, failed: 0 };

export function resetCounters(): void {
  counters.received = 0;
  counters.stored = 0;
  counters.suppressed = 0;
  counters.failed = 0;
}

export function registerHealth(app: FastifyInstance): void {
  app.get("/v1/health", async () => ({
    status: "ok",
    region: "us",
    counters,
  }));
}
