import type { ConsentPurpose } from "@cdp-us/contracts";
import type {
  MessengerAdapter,
  SocialAdapter,
} from "./adapters.js";

/**
 * Synchronous consent gate.
 *
 * Given a recipient address and a consent purpose, returns whether the subject
 * has the required consent on record. The automation module never stores
 * consent itself — it asks the consent module via this injected predicate.
 *
 * For TCPA, the relevant purpose is `"messaging_tcpa"` (prior express consent
 * for marketing messages).
 */
export type ConsentCheck = (to: string, purpose: ConsentPurpose) => boolean;

/** Publishes content to a social channel. */
export interface SocialPostStep {
  kind: "social_post";
  content: string;
}

/**
 * Sends a 1:1 messenger message.
 *
 * When `marketing` is true the step is gated by TCPA: it is only sent if
 * {@link AutomationContext.consentCheck} returns true for `"messaging_tcpa"`,
 * otherwise it is recorded as `skipped` (never delivered).
 *
 * Non-marketing (transactional) messages are not gated by this rule.
 */
export interface MessengerSendStep {
  kind: "messenger_send";
  to: string;
  content: string;
  /** Marketing messages require TCPA prior express consent. Defaults to false. */
  marketing?: boolean;
}

/** No-op step used for sequencing / spacing within a scenario. */
export interface WaitStep {
  kind: "wait";
  /** Optional advisory delay in ms; the orchestrator does not actually sleep. */
  ms?: number;
}

/** A single executable unit of a scenario. */
export type Step = SocialPostStep | MessengerSendStep | WaitStep;

/** Why a step did not result in a delivery. */
export type SkipReason = "tcpa_consent_missing";

/** Outcome status for an executed step. */
export type StepStatus = "sent" | "posted" | "waited" | "skipped";

/** Result of executing one {@link Step}. */
export interface StepResult {
  /** Index of the step within the scenario. */
  index: number;
  kind: Step["kind"];
  status: StepStatus;
  /** Provider id, present when something was actually delivered. */
  id?: string;
  /** Set when `status === "skipped"`. */
  reason?: SkipReason;
}

/** Dependencies and policy for a scenario run. */
export interface AutomationContext {
  social: SocialAdapter;
  messenger: MessengerAdapter;
  /**
   * Consent predicate (typically backed by the consent module).
   * Required for any marketing `messenger_send`; if omitted, marketing
   * messenger sends are treated as having no consent and are skipped.
   */
  consentCheck?: ConsentCheck;
}

/** TCPA-relevant consent purpose for messenger marketing. */
export const TCPA_PURPOSE: ConsentPurpose = "messaging_tcpa";

/**
 * Executes automation scenarios step-by-step through injected adapters,
 * enforcing the US TCPA gate on marketing messenger sends.
 */
export class Orchestrator {
  /**
   * Runs `steps` in order against `ctx` and returns one {@link StepResult} per
   * step (same length and order as the input).
   */
  async runScenario(
    steps: readonly Step[],
    ctx: AutomationContext,
  ): Promise<StepResult[]> {
    const results: StepResult[] = [];

    for (let index = 0; index < steps.length; index++) {
      const step = steps[index]!;
      results.push(await this.runStep(step, index, ctx));
    }

    return results;
  }

  private async runStep(
    step: Step,
    index: number,
    ctx: AutomationContext,
  ): Promise<StepResult> {
    switch (step.kind) {
      case "social_post": {
        const { id } = await ctx.social.post(step.content);
        return { index, kind: step.kind, status: "posted", id };
      }

      case "messenger_send": {
        // TCPA gate: marketing messages require prior express consent.
        if (step.marketing) {
          const allowed = ctx.consentCheck
            ? ctx.consentCheck(step.to, TCPA_PURPOSE)
            : false;
          if (!allowed) {
            return {
              index,
              kind: step.kind,
              status: "skipped",
              reason: "tcpa_consent_missing",
            };
          }
        }
        const { id } = await ctx.messenger.send(step.to, step.content);
        return { index, kind: step.kind, status: "sent", id };
      }

      case "wait": {
        // No-op: scenarios stay deterministic and fully offline.
        return { index, kind: step.kind, status: "waited" };
      }
    }
  }
}
