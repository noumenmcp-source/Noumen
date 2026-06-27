'use strict';
/**
 * Channel adapters — ported 1:1 from US modules/automation/adapters.ts.
 * Every outbound integration sits behind a tiny injectable interface so the
 * orchestrator never touches the network. Real RF adapters (Telegram bot / VK)
 * wrap these interfaces; the in-memory fakes run fully offline.
 *
 * @typedef {{post:(content:string)=>Promise<{id:string}>}} SocialAdapter
 * @typedef {{send:(to:string, content:string)=>Promise<{id:string}>}} MessengerAdapter
 */

/** Deterministic in-memory SocialAdapter (ids social_1, social_2, …). */
class InMemorySocialAdapter {
  constructor() { this.posts = []; this._seq = 0; }
  async post(content) { const id = `social_${++this._seq}`; this.posts.push({ id, content }); return { id }; }
}

/** Deterministic in-memory MessengerAdapter (ids msg_1, msg_2, …). */
class InMemoryMessengerAdapter {
  constructor() { this.sent = []; this._seq = 0; }
  async send(to, content) { const id = `msg_${++this._seq}`; this.sent.push({ id, to, content }); return { id }; }
}

module.exports = { InMemorySocialAdapter, InMemoryMessengerAdapter };
