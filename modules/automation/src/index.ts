/**
 * @cdp-us/automation — social + messenger automation for the CDP-US ecosystem.
 *
 * US law only (CCPA/CPRA/CAN-SPAM/TCPA). Marketing messenger sends are gated by
 * TCPA prior express consent (`messaging_tcpa`).
 */
export type {
  DeliveryResult,
  SocialAdapter,
  MessengerAdapter,
  CapturedPost,
  CapturedMessage,
} from "./adapters.js";
export {
  InMemorySocialAdapter,
  InMemoryMessengerAdapter,
} from "./adapters.js";

export type {
  ConsentCheck,
  SocialPostStep,
  MessengerSendStep,
  WaitStep,
  Step,
  SkipReason,
  StepStatus,
  StepResult,
  AutomationContext,
} from "./orchestrator.js";
export { Orchestrator, TCPA_PURPOSE } from "./orchestrator.js";

export { automationManifest } from "./manifest.js";
