import { describe, expect, it, vi } from "vitest";
import { executeDeletion, type DsarEraser } from "./execute.js";
import type { DeletionPlan, DeletionTarget } from "./types.js";

const SUBJECT = { email: "buyer@example.com" } as const;

function plan(targets: readonly DeletionTarget[]): DeletionPlan {
  return {
    tenantId: "t1",
    subject: SUBJECT,
    requestedAt: "2026-06-01T00:00:00.000Z",
    targets,
    deletableTargets: targets.filter((t) => !t.legalHold),
  };
}

function fakeEraser(deleted = 3): DsarEraser & {
  anonymizeProfile: ReturnType<typeof vi.fn>;
  deleteEvents: ReturnType<typeof vi.fn>;
} {
  return {
    anonymizeProfile: vi.fn(async () => undefined),
    deleteEvents: vi.fn(async () => deleted),
  };
}

describe("executeDeletion", () => {
  it("anonymizes profiles and deletes events for the subject", async () => {
    const eraser = fakeEraser(5);
    const result = await executeDeletion(eraser, plan([
      { type: "profile", key: "p1", action: "anonymize", legalHold: false },
      { type: "event", key: "track:Purchased:t", action: "delete", legalHold: false },
      { type: "derived", key: "buyer@example.com", action: "delete", legalHold: false },
    ]));

    expect(eraser.anonymizeProfile).toHaveBeenCalledWith("t1", "p1");
    expect(eraser.deleteEvents).toHaveBeenCalledWith("t1", SUBJECT);
    expect(result).toMatchObject({ anonymizedProfiles: 1, deletedEvents: 5, retained: [] });
  });

  it("never touches a profile under legal hold", async () => {
    const eraser = fakeEraser();
    const result = await executeDeletion(eraser, plan([
      { type: "profile", key: "p1", action: "retain", legalHold: true, reason: "litigation" },
    ]));

    expect(eraser.anonymizeProfile).not.toHaveBeenCalled();
    expect(result.anonymizedProfiles).toBe(0);
    expect(result.retained).toHaveLength(1);
  });

  it("retains ALL events when any event target is held (no partial delete)", async () => {
    const eraser = fakeEraser();
    const result = await executeDeletion(eraser, plan([
      { type: "event", key: "track:A:t1", action: "delete", legalHold: false },
      { type: "event", key: "track:Purchase:t2", action: "retain", legalHold: true, reason: "tax" },
    ]));

    expect(eraser.deleteEvents).not.toHaveBeenCalled();
    expect(result.deletedEvents).toBe(0);
    expect(result.retained.map((t) => t.key)).toEqual(["track:Purchase:t2"]);
  });

  it("skips event deletion when there are no events", async () => {
    const eraser = fakeEraser();
    const result = await executeDeletion(eraser, plan([
      { type: "profile", key: "p1", action: "anonymize", legalHold: false },
    ]));

    expect(eraser.deleteEvents).not.toHaveBeenCalled();
    expect(result.deletedEvents).toBe(0);
  });
});
