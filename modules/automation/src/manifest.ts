import type { ModuleManifest } from "@cdp-us/contracts";

/**
 * Module manifest for the automation module.
 *
 * Declares the TCPA consent purpose it requires before acting on marketing
 * messenger sends. Social posting to an org's own channels is not gated here.
 */
export const automationManifest: ModuleManifest = {
  key: "automation",
  title: "Social & Messenger Automation",
  description:
    "Schedules social posts and runs messenger scenarios across channels, " +
    "gating marketing messages behind TCPA prior express consent.",
  requiresConsent: ["messaging_tcpa"],
};
