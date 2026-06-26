import type { EmailSender, OutboundMessage, SendResult } from "./types.js";

/**
 * In-memory sender for tests and dry runs. Records every message it is asked
 * to send and returns a deterministic id. Never touches the network.
 */
export class FakeSender implements EmailSender {
  /** All messages handed to {@link send}, in order. */
  readonly sent: OutboundMessage[] = [];
  private seq = 0;

  async send(msg: OutboundMessage): Promise<SendResult> {
    this.sent.push(msg);
    this.seq += 1;
    return Promise.resolve({ id: `fake-${this.seq}` });
  }

  /** Convenience for assertions. */
  get count(): number {
    return this.sent.length;
  }

  /** Reset recorded state between tests. */
  clear(): void {
    this.sent.length = 0;
    this.seq = 0;
  }
}

/** Config for {@link ResendSender}. */
export interface ResendSenderConfig {
  /** Resend API key. Falls back to RESEND_API_KEY env var. */
  apiKey?: string;
}

/** Minimal structural type for the Resend client we depend on. */
interface ResendLike {
  emails: {
    send(payload: {
      from: string;
      to: string | string[];
      subject: string;
      html: string;
    }): Promise<{ data: { id: string } | null; error: unknown }>;
  };
}

/**
 * Real US ESP sender backed by the "resend" package.
 *
 * The Resend client is imported lazily inside {@link send} so that:
 *  - the offline test suite (which uses {@link FakeSender}) never loads it, and
 *  - constructing a ResendSender does not require the dependency at import time.
 */
export class ResendSender implements EmailSender {
  private readonly apiKey: string | undefined;
  private client: ResendLike | undefined;

  constructor(config: ResendSenderConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.RESEND_API_KEY;
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    const client = await this.getClient();
    const { data, error } = await client.emails.send({
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
    });
    if (error || !data) {
      throw new Error(
        `Resend send failed: ${error ? JSON.stringify(error) : "no data returned"}`,
      );
    }
    return { id: data.id };
  }

  private async getClient(): Promise<ResendLike> {
    if (!this.apiKey) {
      throw new Error("ResendSender requires an API key (RESEND_API_KEY).");
    }
    if (!this.client) {
      const mod = (await import("resend")) as {
        Resend: new (apiKey: string) => ResendLike;
      };
      this.client = new mod.Resend(this.apiKey);
    }
    return this.client;
  }
}
