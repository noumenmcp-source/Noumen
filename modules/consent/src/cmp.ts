import type { ConsentState, ConsentPurpose } from "@cdp-us/contracts";

/**
 * US Consent Management Platform (CMP) resolution.
 *
 * US privacy model (CCPA/CPRA + state laws, CAN-SPAM, TCPA):
 *  - analytics:        OPT-OUT  (allowed with notice unless the user opts out)
 *  - sale_or_share:    OPT-OUT  ("Do Not Sell or Share My Personal Information")
 *  - marketing_email:  OPT-IN   (CAN-SPAM still requires unsubscribe honoring)
 *  - messaging_tcpa:   OPT-IN   (TCPA prior express written consent)
 *
 * Global Privacy Control (GPC) is a legally recognized opt-out signal in
 * several states (e.g. CA). When observed it MUST force a "do not sell/share"
 * state regardless of the banner choice.
 */

/** A user's explicit choices captured by the on-site banner / preference center. */
export interface BannerChoice {
  /** User opted out of analytics. Defaults to false (analytics allowed). */
  analyticsOptOut?: boolean;
  /** User opted out of sale/share. Defaults to false (sale/share allowed). */
  saleOrShareOptOut?: boolean;
  /** User opted IN to marketing email. Defaults to false. */
  marketingEmailOptIn?: boolean;
  /** User opted IN to TCPA messaging. Defaults to false. */
  messagingTcpaOptIn?: boolean;
}

export interface ResolveConsentInput {
  /** Choices from the banner / preference center, if any were made. */
  bannerChoice?: BannerChoice;
  /** Whether a Global Privacy Control signal was observed on the request. */
  gpc?: boolean;
}

/**
 * Resolve the effective {@link ConsentState} from the on-site banner choice
 * and any observed GPC signal.
 *
 * Defaults (no banner interaction):
 *  - analytics = true        (opt-out model)
 *  - sale_or_share = true    (opt-out model) — unless GPC forces it off
 *  - marketing_email = false (opt-in)
 *  - messaging_tcpa = false  (opt-in)
 */
export function resolveConsent(input: ResolveConsentInput): ConsentState {
  const banner = input.bannerChoice ?? {};
  const gpc = input.gpc === true;

  // Opt-out purposes: default allowed; honored only when explicitly opted out.
  const analytics = banner.analyticsOptOut === true ? false : true;
  let saleOrShare = banner.saleOrShareOptOut === true ? false : true;

  // Opt-in purposes: default denied; granted only on explicit opt-in.
  const marketingEmail = banner.marketingEmailOptIn === true;
  const messagingTcpa = banner.messagingTcpaOptIn === true;

  // GPC is an enforced opt-out for sale/share and is recorded on the state.
  if (gpc) {
    saleOrShare = false;
  }

  return {
    analytics,
    marketing_email: marketingEmail,
    sale_or_share: saleOrShare,
    messaging_tcpa: messagingTcpa,
    gpc,
  };
}

/** CCPA "Do Not Sell or Share": may we sell/share this subject's PI? */
export function canSellOrShare(state: ConsentState): boolean {
  return state.sale_or_share === true && state.gpc !== true;
}

/** CAN-SPAM: do we have an explicit opt-in to send marketing email? */
export function canEmail(state: ConsentState): boolean {
  return state.marketing_email === true;
}

/** TCPA: do we have prior express consent to send marketing messages? */
export function canMessage(state: ConsentState): boolean {
  return state.messaging_tcpa === true;
}

/**
 * Map a {@link ConsentState} to the set of {@link ConsentPurpose}s currently
 * permitted. Useful for gating modules via their `requiresConsent` manifest.
 */
export function allowedPurposes(state: ConsentState): ConsentPurpose[] {
  const purposes: ConsentPurpose[] = [];
  if (state.analytics) purposes.push("analytics");
  if (canEmail(state)) purposes.push("marketing_email");
  if (canSellOrShare(state)) purposes.push("sale_or_share");
  if (canMessage(state)) purposes.push("messaging_tcpa");
  return purposes;
}
