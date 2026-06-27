import { describe, expect, it, vi } from "vitest";
import { dispatch, renderTemplate, selectChannels } from "./index.js";

describe("notifications", () => {
  it("renders placeholders deterministically", () => {
    expect(renderTemplate("Hi {{ name }}, {{missing}}", { name: "Ada" })).toEqual({ body: "Hi Ada, " });
  });

  it("selects preference-allowed channels and blocks sms without TCPA consent", async () => {
    const notification = { template: "Body", data: {}, channels: ["email", "sms", "slack"] as const };
    expect(await selectChannels(notification, { allowed: ["email", "sms"] }, () => false)).toEqual(["email"]);
  });

  it("dispatches through injected senders and skips missing senders", async () => {
    const email = vi.fn();
    expect(await dispatch({ template: "Hi {{name}}", data: { name: "Ada" }, channels: ["email", "slack"] }, { allowed: ["email", "slack"] }, { email }, { consentCheck: () => true })).toEqual([
      { channel: "email", status: "delivered" },
      { channel: "slack", status: "skipped", reason: "missing_sender" },
    ]);
    expect(email).toHaveBeenCalledWith({ channel: "email", subject: undefined, body: "Hi Ada" });
  });
});
