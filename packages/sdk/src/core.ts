import type { IngestBatch, IngestEvent } from "@cdp-us/contracts";

export interface TrackerOptions {
  writeKey: string;
  /** Ingest endpoint, e.g. https://api.example.com/v1/track */
  endpoint: string;
  /** Flush when this many events are queued. */
  flushAt?: number;
}

/** Pure, DOM-free payload builder (unit-tested). */
export function buildBatch(writeKey: string, events: IngestEvent[]): IngestBatch {
  return { writeKey, events };
}

/** Pure, DOM-free batching queue (unit-tested). */
export class EventQueue {
  private q: IngestEvent[] = [];
  constructor(private readonly flushAt: number = 10) {}

  /** Returns the flushed batch when the threshold is reached, else null. */
  enqueue(ev: IngestEvent): IngestEvent[] | null {
    this.q.push(ev);
    if (this.q.length >= this.flushAt) return this.drain();
    return null;
  }

  drain(): IngestEvent[] {
    const out = this.q;
    this.q = [];
    return out;
  }

  get size(): number {
    return this.q.length;
  }
}
