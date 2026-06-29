/**
 * @cdp-us/email — AI email marketing engine (US: CAN-SPAM / CCPA / CPRA / TCPA).
 *
 * Public API:
 *  - ContentGenerator: TemplateGenerator (default, deterministic, no deps) and
 *    AiGatewayGenerator (OpenAI-compatible AI Gateway over fetch, no SDK).
 *  - enforceCanSpam: appends the legally required footer or throws.
 *  - EmailSender: ResendSender (real ESP) and FakeSender (tests).
 *  - selectRecipients: lifecycle trigger targeting.
 *  - sendCampaign: end-to-end run with a mandatory marketing-consent gate.
 */

export * from "./types.js";
export { enforceCanSpam } from "./canspam.js";
export {
  TemplateGenerator,
  AiGatewayGenerator,
  renderTemplate,
} from "./generators.js";
export type { AiGatewayConfig } from "./generators.js";
export { FakeSender, ResendSender, SmtpSender } from "./senders.js";
export type { ResendSenderConfig, SmtpSenderConfig } from "./senders.js";
export { selectRecipients } from "./triggers.js";
export {
  sendCampaign,
} from "./campaign.js";
export type {
  SendCampaignOptions,
  CampaignResult,
  CampaignRecipientResult,
} from "./campaign.js";
export { emailManifest } from "./manifest.js";
