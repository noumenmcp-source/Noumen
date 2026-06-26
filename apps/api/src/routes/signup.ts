import type { FastifyInstance } from "fastify";
import { selfServeSignupSchema } from "@cdp-us/contracts";
import type { TenantStore } from "../tenant.js";

export function registerSignup(
  app: FastifyInstance,
  tenantStore: TenantStore,
): void {
  app.post("/v1/signup", async (req, reply) => {
    const parsed = selfServeSignupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_signup", issues: parsed.error.issues });
    }

    const { tenant, owner } = await tenantStore.createTenantAccount({
      name: parsed.data.companyName,
      ownerEmail: parsed.data.ownerEmail,
    });

    return reply.code(201).send({
      ok: true,
      tenant,
      owner: {
        id: owner.id,
        tenantId: owner.tenantId,
        email: owner.email,
        role: owner.role,
        createdAt: owner.createdAt,
      },
    });
  });
}
