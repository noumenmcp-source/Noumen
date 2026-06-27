'use strict';
/**
 * Triggered campaign runner — rebuilt from US modules/email/campaign.ts.
 *   select recipients -> MARKETING CONSENT GATE -> generate -> enforce 152-ФЗ -> send.
 *
 * The marketing-consent gate is mandatory (152-ФЗ opt-in): any recipient whose
 * `consentCheck` (async — wired to the consent-ledger marketing_email purpose)
 * does not pass is skipped and counted; no email is generated or sent for them.
 */
const { selectRecipients, emailOf } = require('./triggers');
const { enforce152fz } = require('./compliance');

/**
 * @param {Object} opts
 * @param {Array} opts.profiles
 * @param {string} opts.trigger
 * @param {string} opts.from
 * @param {string} opts.brandName
 * @param {string} [opts.productName]
 * @param {string} [opts.ctaUrl]
 * @param {{generate:Function}} opts.generator
 * @param {{send:Function}} opts.sender
 * @param {{operator:string, unsubscribeUrl:string}} opts.compliance
 * @param {(subject:string)=>Promise<boolean>|boolean} opts.consentCheck
 * @param {(profile:any)=>string} [opts.subjectOf]
 */
async function runCampaign(opts) {
  const subjectOf = opts.subjectOf || defaultSubjectOf;
  const selected = selectRecipients(opts.profiles, opts.trigger);

  let sent = 0;
  let skippedNoConsent = 0;
  const results = [];

  for (const profile of selected) {
    const consentSubject = subjectOf(profile);
    const ok = await opts.consentCheck(consentSubject);
    if (!ok) { skippedNoConsent += 1; continue; }

    const generated = await opts.generator.generate(profile, {
      trigger: opts.trigger, brandName: opts.brandName, productName: opts.productName, ctaUrl: opts.ctaUrl,
    });
    const html = enforce152fz(generated.html, opts.compliance);
    const sendResult = await opts.sender.send({ to: emailOf(profile), from: opts.from, subject: generated.subject, html });

    sent += 1;
    results.push({ profileId: profile.id, email: emailOf(profile), subject: generated.subject, html, messageId: sendResult.id });
  }

  return { trigger: opts.trigger, selected: selected.length, sent, skippedNoConsent, results };
}

function defaultSubjectOf(profile) {
  return emailOf(profile) || profile.userId || profile.anonymousId || profile.id;
}

module.exports = { runCampaign };
