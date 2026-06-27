'use strict';
/**
 * Email senders. In RF, delivery belongs to the live Dittofeed; this module
 * ports the US sender abstraction + FakeSender, and provides a DittofeedSender
 * placeholder that hands a composed message to Dittofeed.
 */

/** In-memory sender for tests, dry-runs, and previews. Never touches network. */
class FakeSender {
  constructor() { this.sent = []; this._seq = 0; }
  async send(msg) { this.sent.push(msg); this._seq += 1; return { id: `fake-${this._seq}` }; }
  get count() { return this.sent.length; }
  clear() { this.sent.length = 0; this._seq = 0; }
}

/**
 * Hands a fully-composed, 152-ФЗ-compliant message to Dittofeed for delivery.
 *
 * NOTE: the concrete Dittofeed transactional-send wiring (workspace + message
 * template + API) is a follow-up; today this throws unless a `deliver` function
 * is injected, so the verified path is preview/dry-run with FakeSender.
 */
class DittofeedSender {
  constructor(config = {}) {
    this.deliver = config.deliver; // (msg) => Promise<{id}>
  }
  async send(msg) {
    if (typeof this.deliver !== 'function') {
      throw new Error('DittofeedSender: delivery not wired yet (use preview/dry-run or inject `deliver`).');
    }
    return this.deliver(msg);
  }
}

module.exports = { FakeSender, DittofeedSender };
