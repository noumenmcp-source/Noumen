import type { Tenant } from "@cdp-us/contracts";

/**
 * In-memory tenant registry (foundation stub).
 * Replaced by a db-backed lookup once the platform module lands.
 */
const demo: Tenant = {
  id: "demo",
  name: "Demo US B2B",
  writeKey: "wk_demo_us",
  region: "us",
  enabledModules: ["email", "consent"],
  createdAt: new Date(0).toISOString(),
};

const byKey = new Map<string, Tenant>([[demo.writeKey, demo]]);

export function resolveTenant(writeKey: string): Tenant | undefined {
  return byKey.get(writeKey);
}
