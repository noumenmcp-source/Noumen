import { describe, expect, it } from "vitest";
import { consentField, submissionToEvents, validateSubmission, type FormDefinition } from "./index.js";

const form: FormDefinition = {
  key: "demo",
  fields: [
    { name: "email", type: "email", required: true },
    { name: "company", type: "text" },
    { name: "employees", type: "number" },
    { name: "plan", type: "select", options: ["starter", "pro"] },
    { name: "ccpaNotice", type: "checkbox", consent: true },
  ],
};

describe("forms", () => {
  it("validates required, email, number, select, and checkbox fields", () => {
    expect(validateSubmission(form, { email: "bad", employees: "10", plan: "bad", ccpaNotice: "yes" }).issues).toEqual([
      { field: "email", code: "invalid_email" },
      { field: "employees", code: "invalid_number" },
      { field: "plan", code: "invalid_option" },
      { field: "ccpaNotice", code: "invalid_checkbox" },
    ]);
    expect(validateSubmission(form, { email: "", plan: "pro" }).issues[0]).toEqual({ field: "email", code: "required" });
  });

  it("maps valid submissions to identify and track events", () => {
    const events = submissionToEvents(form, { email: "Buyer@Example.com", company: "Acme", employees: 12, plan: "pro", ccpaNotice: true }, "anon_1");

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "identify", anonymousId: "anon_1", traits: { email: "buyer@example.com", company: "Acme" } });
    expect(events[1]).toMatchObject({ type: "track", anonymousId: "anon_1", event: "Form Submitted" });
  });

  it("does not emit partial events for invalid submissions and finds consent fields", () => {
    expect(submissionToEvents(form, { email: "bad" }, "anon_1")).toEqual([]);
    expect(consentField(form)?.name).toBe("ccpaNotice");
  });
});
