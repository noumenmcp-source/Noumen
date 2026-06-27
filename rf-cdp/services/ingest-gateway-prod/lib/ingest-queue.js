'use strict';
/**
 * Bounded ring buffer for the ingest hot path.
 *
 * The gateway must ack POST /v1/* in O(1) without ever growing memory unbounded.
 * push() drops (returns false) once the buffer is full so the caller can emit 503
 * instead of queueing forever under backpressure; shift() drains FIFO for the worker.
 * Backed by a fixed-length array with head/tail indices and a live count — no splice,
 * no array growth, no allocation per op. `dropped` counts rejected pushes (for /health).
 */

function createQueue(opts) {
  const { maxSize = 100000 } = opts || {};
  if (!Number.isInteger(maxSize) || maxSize <= 0) throw new Error('maxSize must be a positive integer');

  const buf = new Array(maxSize); // fixed slots holding object refs
  let head = 0; // next index to shift (read)
  let tail = 0; // next index to push (write)
  let count = 0; // live items in buffer
  let dropped = 0; // rejected pushes (buffer full)

  return {
    // O(1) enqueue; false when full (caller should 503), no growth.
    push(item) {
      if (count === maxSize) { dropped++; return false; }
      buf[tail] = item;
      tail = tail + 1 === maxSize ? 0 : tail + 1;
      count++;
      return true;
    },
    // O(1) FIFO dequeue; null when empty.
    shift() {
      if (count === 0) return null;
      const item = buf[head];
      buf[head] = undefined; // release ref so GC can reclaim
      head = head + 1 === maxSize ? 0 : head + 1;
      count--;
      return item;
    },
    size() { return count; },
    get dropped() { return dropped; },
  };
}

module.exports = { createQueue };

// --- inline self-test: node lib/ingest-queue.js ---
if (require.main === module) {
  const assert = require('assert');
  const maxSize = 100;
  const q = createQueue({ maxSize });

  // Push maxSize+10: first maxSize accepted, last 10 rejected.
  let accepted = 0, rejected = 0;
  for (let i = 0; i < maxSize + 10; i++) (q.push(i) ? accepted++ : rejected++);
  assert.strictEqual(rejected, 10, `expected 10 rejected, got ${rejected}`);
  assert.strictEqual(accepted, maxSize, `expected ${maxSize} accepted, got ${accepted}`);
  assert.strictEqual(q.size(), maxSize, `expected size==${maxSize}, got ${q.size()}`);
  assert.strictEqual(q.dropped, 10, `expected dropped==10, got ${q.dropped}`);

  // FIFO order preserved on drain.
  assert.strictEqual(q.shift(), 0, 'expected FIFO: first shift == 0');
  assert.strictEqual(q.shift(), 1, 'expected FIFO: second shift == 1');
  assert.strictEqual(q.size(), maxSize - 2, 'size should decrement on shift');

  // Wrap-around: refill the two freed slots, drain fully, assert empty + null.
  assert.strictEqual(q.push('a'), true, 'push after shift should succeed (slot freed)');
  assert.strictEqual(q.push('b'), true, 'push after shift should succeed (slot freed)');
  assert.strictEqual(q.push('c'), false, 'push should fail again at capacity');
  while (q.shift() !== null) { /* drain */ }
  assert.strictEqual(q.size(), 0, 'queue should be empty after full drain');
  assert.strictEqual(q.shift(), null, 'shift on empty returns null');

  // dropped is read-only / monotonic accessor.
  assert.strictEqual(q.dropped, 11, `expected dropped==11 after one more full reject, got ${q.dropped}`);

  console.log('ingest-queue self-test OK: 10 rejected, size==maxSize, FIFO + wrap-around verified');
}
