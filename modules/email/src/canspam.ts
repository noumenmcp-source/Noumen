import type { CanSpamOptions } from "./types.js";

/**
 * CAN-SPAM (15 U.S.C. ch.103) footer enforcement.
 *
 * Every commercial message MUST contain:
 *  - a valid physical postal address of the sender, and
 *  - a clear, working unsubscribe mechanism.
 *
 * Throws when either is missing so we can never ship a non-compliant email.
 */
export function enforceCanSpam(html: string, opts: CanSpamOptions): string {
  const physicalAddress = (opts.physicalAddress ?? "").trim();
  const unsubscribeUrl = (opts.unsubscribeUrl ?? "").trim();

  if (!physicalAddress) {
    throw new Error(
      "CAN-SPAM violation: a valid physical postal address is required.",
    );
  }
  if (!unsubscribeUrl) {
    throw new Error(
      "CAN-SPAM violation: a working unsubscribe URL is required.",
    );
  }

  const footer =
    `<div class="cdp-canspam-footer" ` +
    `style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e5e5;` +
    `font-size:12px;color:#666;line-height:1.5;">` +
    `<p style="margin:0 0 8px;">${escapeHtml(physicalAddress)}</p>` +
    `<p style="margin:0;">You are receiving this email because you opted in. ` +
    `<a href="${escapeAttr(unsubscribeUrl)}">Unsubscribe</a> at any time.</p>` +
    `</div>`;

  // Inject before </body> when present so the footer stays inside the document.
  const closingBody = /<\/body>/i;
  if (closingBody.test(html)) {
    return html.replace(closingBody, `${footer}</body>`);
  }
  return `${html}${footer}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
