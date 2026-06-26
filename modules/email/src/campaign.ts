import type { Profile } from "@cdp-us/contracts";
import { enforceCanSpam } from "./canspam.js";
import { selectRecipients } from "./triggers.js";
import type {
  CanSpamOptions,
  ConsentCheck,
  ContentGenerator,
  EmailSender,
  EmailTrigger,
} from "./types.js";

/** Input to {@link sendCampaign}. */
export interface SendCampaignOptions {
  profiles: Profile[];
  trigger: EmailTrigger;
  /** Verified sender address (CAN-SPAM honest "from"). */
  from: string;
  brandName: string;
  productName?: string;
  ctaUrl?: string;
  generator: ContentGenerator;
  sender: EmailSender;
  /** CAN-SPAM footer data; enforced on every message. */
  canSpam: CanSpamOptions;
  /**
   * Consent gate for the "marketing_email" purpose. Must return true only for
   * subjects that have opted in. Recipients failing this are skipped + counted.
   */
  consentCheck: ConsentCheck;
  /**
   * How to derive the consent subject from a profile. Defaults to the email
   * (the consent ledger keys on anonymousId or hashed email).
   */
  subjectOf?: (profile: Profile) => string;
}

/** Per-recipient outcome record. */
export interface CampaignRecipientResult {
  profileId: string;
  email: string;
  subject: string;
  messageId: string;
}

/** Aggregate result of a campaign run. */
export interface CampaignResult {
  trigger: EmailTrigger;
  /** Recipients selected by the trigger (before the consent gate). */
  selected: number;
  /** Messages actually sent. */
  sent: number;
  /** Recipients skipped because they had not consented to marketing_email. */
  skippedNoConsent: number;
  results: CampaignRecipientResult[];
}

/**
 * Run a triggered email campaign end to end:
 *   select recipients -> consent gate -> generate -> enforce CAN-SPAM -> send.
 *
 * The "marketing_email" consent gate is mandatory (opt-in model). Any recipient
 * that does not pass {@link SendCampaignOptions.consentCheck} is skipped and
 * counted in {@link CampaignResult.skippedNoConsent}; no email is generated or
 * sent for them.
 */
export async function sendCampaign(
  opts: SendCampaignOptions,
): Promise<CampaignResult> {
  const subjectOf = opts.subjectOf ?? defaultSubjectOf;
  const selectedProfiles = selectRecipients(opts.profiles, opts.trigger);

  let sent = 0;
  let skippedNoConsent = 0;
  const results: CampaignRecipientResult[] = [];

  for (const profile of selectedProfiles) {
    const consentSubject = subjectOf(profile);
    if (!opts.consentCheck(consentSubject)) {
      skippedNoConsent += 1;
      continue;
    }

    const generated = await opts.generator.generate(profile, {
      trigger: opts.trigger,
      brandName: opts.brandName,
      productName: opts.productName,
      ctaUrl: opts.ctaUrl,
    });

    const html = enforceCanSpam(generated.html, opts.canSpam);

    const sendResult = await opts.sender.send({
      to: profile.email as string,
      from: opts.from,
      subject: generated.subject,
      html,
    });

    sent += 1;
    results.push({
      profileId: profile.id,
      email: profile.email as string,
      subject: generated.subject,
      messageId: sendResult.id,
    });
  }

  return {
    trigger: opts.trigger,
    selected: selectedProfiles.length,
    sent,
    skippedNoConsent,
    results,
  };
}

function defaultSubjectOf(profile: Profile): string {
  return profile.email ?? profile.anonymousId ?? profile.id;
}
