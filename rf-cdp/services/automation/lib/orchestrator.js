'use strict';
/**
 * Scenario orchestrator — ported from US modules/automation/orchestrator.ts.
 * Runs steps in order through injected adapters. The US TCPA gate
 * (`messaging_tcpa`) is rebuilt as a 152-ФЗ / «О рекламе» marketing-messaging
 * gate: marketing messenger sends require `marketing_messaging` consent,
 * otherwise the step is recorded as `skipped` (never delivered).
 *
 * Step kinds: social_post {content}; messenger_send {to, content, marketing?};
 * wait {ms?} (no-op — scenarios stay deterministic and offline).
 *
 * consentCheck is async (RF wires it to the consent-ledger over HTTP) and
 * fail-closed: omitted ⇒ marketing messenger sends are skipped.
 */
const MESSAGING_PURPOSE = 'marketing_messaging';

class Orchestrator {
  async runScenario(steps, ctx) {
    const results = [];
    for (let index = 0; index < steps.length; index++) {
      results.push(await this.runStep(steps[index], index, ctx));
    }
    return results;
  }

  async runStep(step, index, ctx) {
    switch (step.kind) {
      case 'social_post': {
        const { id } = await ctx.social.post(step.content);
        return { index, kind: step.kind, status: 'posted', id };
      }
      case 'messenger_send': {
        if (step.marketing) {
          const allowed = ctx.consentCheck ? await ctx.consentCheck(step.to, MESSAGING_PURPOSE) : false;
          if (!allowed) {
            return { index, kind: step.kind, status: 'skipped', reason: 'messaging_consent_missing' };
          }
        }
        const { id } = await ctx.messenger.send(step.to, step.content);
        return { index, kind: step.kind, status: 'sent', id };
      }
      case 'wait':
        return { index, kind: step.kind, status: 'waited' };
      default:
        return { index, kind: step && step.kind, status: 'skipped', reason: 'unknown_step' };
    }
  }
}

module.exports = { Orchestrator, MESSAGING_PURPOSE };
