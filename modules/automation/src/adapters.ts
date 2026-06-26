/**
 * Channel adapters for the automation module.
 *
 * Every outbound integration (social network, messenger/SMS provider) is hidden
 * behind a tiny injectable interface so the orchestrator never talks to the
 * network directly. Tests inject the in-memory fakes below and run fully offline.
 */

/** Result of a successful outbound send/post. */
export interface DeliveryResult {
  /** Provider-side message/post identifier. */
  id: string;
}

/**
 * Publishes content to a social channel (e.g. an org's timeline / page).
 * Implementations wrap the real provider API; the orchestrator only sees `post`.
 */
export interface SocialAdapter {
  post(content: string): Promise<DeliveryResult>;
}

/**
 * Sends a 1:1 message to a recipient on a messenger / SMS channel.
 * `to` is the channel-specific address (phone number, handle, chat id, …).
 */
export interface MessengerAdapter {
  send(to: string, content: string): Promise<DeliveryResult>;
}

/** A post captured by {@link InMemorySocialAdapter}. */
export interface CapturedPost {
  id: string;
  content: string;
}

/** A message captured by {@link InMemoryMessengerAdapter}. */
export interface CapturedMessage {
  id: string;
  to: string;
  content: string;
}

/**
 * Deterministic in-memory {@link SocialAdapter} for tests.
 * Records every post and returns predictable ids (`social_1`, `social_2`, …).
 */
export class InMemorySocialAdapter implements SocialAdapter {
  readonly posts: CapturedPost[] = [];
  private seq = 0;

  async post(content: string): Promise<DeliveryResult> {
    const id = `social_${++this.seq}`;
    this.posts.push({ id, content });
    return { id };
  }
}

/**
 * Deterministic in-memory {@link MessengerAdapter} for tests.
 * Records every send and returns predictable ids (`msg_1`, `msg_2`, …).
 */
export class InMemoryMessengerAdapter implements MessengerAdapter {
  readonly sent: CapturedMessage[] = [];
  private seq = 0;

  async send(to: string, content: string): Promise<DeliveryResult> {
    const id = `msg_${++this.seq}`;
    this.sent.push({ id, to, content });
    return { id };
  }
}
