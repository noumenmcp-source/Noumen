/**
 * @cdp-us/consent — US Consent Management Platform (CMP) + signed consent ledger.
 *
 * US law only: CCPA/CPRA, state privacy laws, CAN-SPAM, TCPA.
 * Not legal advice — requires review by US counsel.
 */

export {
  ConsentLedger,
  verifyChain,
  computeRecordHash,
  GENESIS_HASH,
  type AppendInput,
  type VerifyResult,
  type LedgerKeys,
} from "./ledger.js";

export {
  resolveConsent,
  canSellOrShare,
  canEmail,
  canMessage,
  allowedPurposes,
  type BannerChoice,
  type ResolveConsentInput,
} from "./cmp.js";
