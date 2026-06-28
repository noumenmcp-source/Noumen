/**
 * @cdp-us/copy — message copy for playbook actions + a quality gate.
 * Deck slides 4/7: "a ready action = segment + email/SMS copy". A deterministic
 * template generator produces a baseline draft; `validateCopy` is the gate so
 * NO copy (template or LLM-generated, e.g. via Flot later) ships unvalidated.
 */

export type CopyKind = "win_back" | "resell" | "chase_leads" | "reactivate" | "exclude_junk";
export type CopyChannel = "email" | "sms" | "task" | "ad_audience";

/** @example const brand: Brand = { name: "Brew Co" }; */
export type Brand = Readonly<{ name: string; senderName?: string }>;

/** @example const draft: CopyDraft = draftCopy({ kind: "win_back", channel: "email", brand }); */
export type CopyDraft = Readonly<{
  channel: CopyChannel;
  subject?: string;
  body: string;
  /** Merge tags present in the copy, e.g. ["firstName"]. */
  mergeTags: readonly string[];
}>;

export type CopyIssue =
  | "empty"
  | "subject_too_long"
  | "body_too_long"
  | "missing_personalization"
  | "missing_unsubscribe"
  | "missing_sms_optout"
  | "spam_word";

export type CopyValidation = Readonly<{ ok: boolean; issues: readonly CopyIssue[] }>;

const SPAM_WORDS = ["act now", "100% free", "free money", "click here now", "risk-free", "winner!"];
const MERGE_TAG = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Baseline template copy for an action. Returns null for channels that carry no
 * customer-facing message (ad_audience = a suppression list, not a send).
 *
 * @example draftCopy({ kind: "win_back", channel: "email", brand: { name: "Brew Co" } });
 */
export function draftCopy(input: { kind: CopyKind; channel: CopyChannel; brand: Brand }): CopyDraft | null {
  const brand = input.brand.name.trim() || "us";
  if (input.channel === "ad_audience") return null;

  if (input.channel === "task") {
    return withTags({ channel: "task", body: taskNote(input.kind) });
  }

  if (input.channel === "sms") {
    return withTags({ channel: "sms", body: `${smsBody(input.kind, brand)} Reply STOP to opt out.` });
  }

  // email
  const { subject, body } = emailCopy(input.kind, brand);
  return withTags({ channel: "email", subject, body: `${body}\n\nUnsubscribe: {{unsubscribeUrl}}` });
}

/**
 * Quality gate. Channel-aware: email needs personalization + an unsubscribe
 * link (CAN-SPAM); SMS needs an opt-out (TCPA); nothing may contain spam words.
 *
 * @example validateCopy(draft).ok;
 */
export function validateCopy(draft: CopyDraft): CopyValidation {
  const issues: CopyIssue[] = [];
  const text = `${draft.subject ?? ""}\n${draft.body}`;
  const lower = text.toLowerCase();

  if (!draft.body.trim()) issues.push("empty");
  if ((draft.subject?.length ?? 0) > 90) issues.push("subject_too_long");

  if (draft.channel === "email") {
    if (draft.body.length > 5000) issues.push("body_too_long");
    if (!draft.mergeTags.includes("firstName")) issues.push("missing_personalization");
    if (!/unsubscribe/i.test(draft.body)) issues.push("missing_unsubscribe");
  }
  if (draft.channel === "sms") {
    if (draft.body.length > 320) issues.push("body_too_long");
    if (!draft.mergeTags.includes("firstName")) issues.push("missing_personalization");
    if (!/\bstop\b/i.test(draft.body)) issues.push("missing_sms_optout");
  }
  if (SPAM_WORDS.some((word) => lower.includes(word))) issues.push("spam_word");

  return { ok: issues.length === 0, issues };
}

function emailCopy(kind: CopyKind, brand: string): { subject: string; body: string } {
  switch (kind) {
    case "win_back":
      return { subject: `We miss you at ${brand}`, body: `Hi {{firstName}}, it's been a while. Here's 15% off your next order — come back and see what's new at ${brand}.` };
    case "reactivate":
      return { subject: `One last hello from ${brand}`, body: `Hi {{firstName}}, we'd love to have you back at ${brand}. Here's a returning-customer offer, just for you.` };
    case "resell":
      return { subject: `A pick for you, {{firstName}}`, body: `Hi {{firstName}}, thanks for being a ${brand} regular. Based on what you bought, here's something you'll like.` };
    case "chase_leads":
      return { subject: `Getting started with ${brand}`, body: `Hi {{firstName}}, thanks for signing up to ${brand}. Here's how to get your first result in five minutes.` };
    case "exclude_junk":
      return { subject: "", body: "" };
  }
}

function smsBody(kind: CopyKind, brand: string): string {
  if (kind === "resell") return `{{firstName}}, thanks for being a ${brand} regular — your next order ships free.`;
  if (kind === "win_back") return `{{firstName}}, we miss you at ${brand}. 15% off if you come back this week.`;
  return `{{firstName}}, a quick note from ${brand}.`;
}

function taskNote(kind: CopyKind): string {
  if (kind === "chase_leads") return "Follow up with {{firstName}} — fresh signup, no purchase yet. Qualify and book a call.";
  return "Follow up with {{firstName}} for {{brand}}.";
}

function withTags(draft: Omit<CopyDraft, "mergeTags">): CopyDraft {
  const tags = new Set<string>();
  for (const text of [draft.subject ?? "", draft.body]) {
    for (const match of text.matchAll(MERGE_TAG)) if (match[1]) tags.add(match[1]);
  }
  return { ...draft, mergeTags: [...tags] };
}
