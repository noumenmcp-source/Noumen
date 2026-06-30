import type { FastifyInstance } from "fastify";
import { authenticate, type TokenStore } from "../auth.js";

/**
 * Session-management endpoints over bearer tokens:
 *  - GET  /v1/auth/introspect — who am I (validates the token server-side)
 *  - POST /v1/auth/logout     — revoke the calling token (server-side invalidation)
 *
 * @example registerAuth(app, tokenStore);
 */
export function registerAuth(app: FastifyInstance, tokenStore: TokenStore): void {
  app.get("/v1/auth/introspect", async (req, reply) => {
    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ active: false });
    return reply.send({
      active: true,
      tokenId: principal.tokenId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      role: principal.role,
    });
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    await tokenStore.revoke(principal.tokenId);
    return reply.code(204).send();
  });
}
