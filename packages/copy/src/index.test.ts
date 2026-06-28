import { describe, expect, it } from "vitest";
import { draftCopy, validateCopy, type CopyDraft } from "./index.js";

const brand = { name: "Brew Co" };

describe("draftCopy", () => {
  it("drafts personalized, unsubscribe-bearing email copy", () => {
    const draft = draftCopy({ kind: "win_back", channel: "email", brand })!;
    expect(draft.channel).toBe("email");
    expect(draft.subject).toContain("Brew Co");
    expect(draft.mergeTags).toContain("firstName");
    expect(draft.body).toMatch(/unsubscribe/i);
    expect(validateCopy(draft).ok).toBe(true);
  });

  it("drafts SMS copy with a STOP opt-out", () => {
    const draft = draftCopy({ kind: "resell", channel: "sms", brand })!;
    expect(draft.channel).toBe("sms");
    expect(draft.body).toMatch(/stop/i);
    expect(draft.mergeTags).toContain("firstName");
    expect(validateCopy(draft).ok).toBe(true);
  });

  it("returns null for ad_audience (no message)", () => {
    expect(draftCopy({ kind: "exclude_junk", channel: "ad_audience", brand })).toBeNull();
  });

  it("drafts an internal task note", () => {
    const draft = draftCopy({ kind: "chase_leads", channel: "task", brand })!;
    expect(draft.channel).toBe("task");
    expect(draft.body).toContain("Follow up");
  });
});

describe("validateCopy (quality gate)", () => {
  it("flags email missing personalization + unsubscribe", () => {
    const draft: CopyDraft = { channel: "email", subject: "Hi", body: "Come back", mergeTags: [] };
    expect(validateCopy(draft).issues).toEqual(expect.arrayContaining(["missing_personalization", "missing_unsubscribe"]));
  });

  it("flags SMS missing opt-out", () => {
    const draft: CopyDraft = { channel: "sms", body: "{{firstName}} buy now", mergeTags: ["firstName"] };
    expect(validateCopy(draft).issues).toContain("missing_sms_optout");
  });

  it("flags spam words", () => {
    const draft: CopyDraft = { channel: "email", body: "{{firstName}} act now! unsubscribe {{unsubscribeUrl}}", mergeTags: ["firstName", "unsubscribeUrl"] };
    expect(validateCopy(draft).issues).toContain("spam_word");
  });

  it("flags an over-long subject and empty body", () => {
    const draft: CopyDraft = { channel: "email", subject: "x".repeat(91), body: "  ", mergeTags: [] };
    const issues = validateCopy(draft).issues;
    expect(issues).toContain("subject_too_long");
    expect(issues).toContain("empty");
  });
});
