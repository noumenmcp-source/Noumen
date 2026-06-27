export { createConsentManager } from "./manager.js";
export {
  acceptAllConsent,
  defaultConsent,
  getPurposes,
  isAllowed,
  isConsentState,
  rejectNonEssentialConsent,
  withGpc,
} from "./state.js";
export type {
  ConsentChange,
  ConsentListener,
  ConsentManager,
  ConsentManagerOptions,
  ConsentPurpose,
  ConsentSource,
  ConsentState,
} from "./types.js";
