import { describe, expect, it } from "vitest";
import { SmtpSender } from "./senders.js";
import type { OutboundMessage } from "./types.js";

const MSG: OutboundMessage = {
  to: "buyer@acme.example",
  from: "hi@brand.example",
  subject: "Welcome",
  html: "<p>hi</p>",
};

describe("SmtpSender", () => {
  it("sends via the injected transport and returns its messageId", async () => {
    const calls: unknown[] = [];
    const sender = new SmtpSender(
      { url: "smtps://u:p@mail.example:465" },
      {
        async sendMail(opts) {
          calls.push(opts);
          return { messageId: "smtp-123" };
        },
      },
    );

    const result = await sender.send(MSG);

    expect(result).toEqual({ id: "smtp-123" });
    expect(calls).toEqual([
      { to: MSG.to, from: MSG.from, subject: MSG.subject, html: MSG.html },
    ]);
  });

  it("throws when the transport returns no messageId", async () => {
    const sender = new SmtpSender({ url: "smtp://mail.example:25" }, {
      async sendMail() {
        return {};
      },
    });
    await expect(sender.send(MSG)).rejects.toThrow(/no messageId/);
  });

  it("throws when no SMTP_URL is configured and no transport is injected", async () => {
    const sender = new SmtpSender({ url: "" });
    await expect(sender.send(MSG)).rejects.toThrow(/SMTP_URL/);
  });
});
