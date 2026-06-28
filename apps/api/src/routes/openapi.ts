import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";

/**
 * The OpenAPI document lives at the package root (apps/api/openapi.json) and is
 * resolved relative to this module so it works from both src (vitest) and dist.
 */
const SPEC_URL = new URL("../../openapi.json", import.meta.url);
const spec: unknown = JSON.parse(readFileSync(SPEC_URL, "utf-8"));

/** Serves the API's own OpenAPI 3.1 description for discovery / client gen. */
export function registerOpenapi(app: FastifyInstance): void {
  app.get("/v1/openapi.json", async (_req, reply) => {
    return reply.header("content-type", "application/json").send(spec);
  });
}
