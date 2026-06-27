import type { FastifyInstance } from "fastify";
import { selfServeSignupSchema } from "@cdp-us/contracts";
import type { TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

/**
 * Self-serve US tenant signup. Creates the tenant + owner and mints the
 * owner's API token (returned once as `apiToken`).
 * @example POST /v1/signup { companyName, ownerEmail } -> 201 { tenant, owner, apiToken }
 */
export function registerSignup(
  app: FastifyInstance,
  tenantStore: TenantStore,
  tokenStore: TokenStore,
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

    const { token } = await tokenStore.issue({
      tenantId: tenant.id,
      userId: owner.id,
      role: owner.role,
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
      apiToken: token,
    });
  });
}
