import type { Profile } from "@cdp-us/contracts";

/**
 * Email module public types.
 * US-only system (CAN-SPAM / CCPA / CPRA / TCPA). English customer-facing copy.
 */

/** Automated lifecycle triggers. The wedge ships three; more can be added. */
export const EMAIL_TRIGGERS = [
  "welcome",
  "abandoned_cart",
  "reactivation",
] as const;
export type EmailTrigger = (typeof EMAIL_TRIGGERS)[number];

/** Context handed to a content generator for one recipient. */
export interface GenerationContext {
  /** The lifecycle trigger this email is being generated for. */
  trigger: EmailTrigger;
  /** Tenant / sender company name used in copy. */
  brandName: string;
  /** Optional product/offer name for cart or promo flows. */
  productName?: string;
  /** Optional CTA target URL. */
  ctaUrl?: string;
}

/** The raw generated email, before legal footer enforcement. */
export interface GeneratedEmail {
  subject: string;
  html: string;
}

/**
 * Pluggable content generator. Implementations may be fully deterministic
 * (TemplateGenerator) or call an external AI Gateway (AiGatewayGenerator).
 */
export interface ContentGenerator {
  generate(profile: Profile, ctx: GenerationContext): Promise<GeneratedEmail>;
}

/** An email ready to hand to an ESP. */
export interface OutboundMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
}

/** Result of a successful send. */
export interface SendResult {
  id: string;
}

/**
 * Pluggable email sender (ESP). ResendSender talks to a real US ESP;
 * FakeSender records messages in memory for tests.
 */
export interface EmailSender {
  send(msg: OutboundMessage): Promise<SendResult>;
}

/** CAN-SPAM footer requirements. Both fields are mandatory by law. */
export interface CanSpamOptions {
  /** Valid physical postal address of the sender. */
  physicalAddress: string;
  /** One-click / working unsubscribe URL. */
  unsubscribeUrl: string;
}

/**
 * Consent check for a subject. Must return true only when the subject has
 * opted in to "marketing_email". Injected so tests run offline.
 */
export type ConsentCheck = (subject: string) => boolean;
