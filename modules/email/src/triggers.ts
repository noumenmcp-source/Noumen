import type { Profile } from "@cdp-us/contracts";
import type { EmailTrigger } from "./types.js";

/**
 * Recipient selection per lifecycle trigger.
 *
 * Pure and deterministic: given the same profiles it returns the same subset,
 * in input order. A profile must have an email to be eligible for any trigger.
 */
export function selectRecipients(
  profiles: Profile[],
  trigger: EmailTrigger,
): Profile[] {
  return profiles.filter((p) => hasEmail(p) && matchesTrigger(p, trigger));
}

function hasEmail(p: Profile): boolean {
  return typeof p.email === "string" && p.email.trim().length > 0;
}

function matchesTrigger(p: Profile, trigger: EmailTrigger): boolean {
  switch (trigger) {
    case "welcome":
      // Newly identified profiles: identified (has email) and not yet welcomed.
      return p.traits["welcomed"] !== true;

    case "abandoned_cart":
      // A cart trait was set but the order was never completed.
      return (
        p.traits["cartItemCount"] != null &&
        toNumber(p.traits["cartItemCount"]) > 0 &&
        p.traits["orderCompleted"] !== true
      );

    case "reactivation": {
      // Dormant: low/no recent activity and previously active.
      const last = p.intent.lastActiveAt;
      if (!last) return false;
      const ms = Date.parse(last);
      if (Number.isNaN(ms)) return false;
      const days = (Date.now() - ms) / 86_400_000;
      return days >= 30;
    }
  }
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}
