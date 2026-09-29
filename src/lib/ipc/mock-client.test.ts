import { describe, expect, it } from "vitest";
import { createMockClient } from "./mock-client";
import { sessions } from "./mock-data";

describe("mock IPC client", () => {
  const ipc = createMockClient();

  it("returns data that satisfies the IPC schemas", async () => {
    // Every mock method parses through the schemas, so these reject if the contract drifts.
    await expect(ipc.getTodayPlan("standard")).resolves.toBeTruthy();
    await expect(ipc.listSessions()).resolves.toHaveLength(sessions.length);
    await expect(ipc.getProgress("unfamiliar")).resolves.toBeTruthy();
    await expect(ipc.listInputDevices()).resolves.toHaveLength(2);
  });

  it("keeps sample annotations inside their segment text", async () => {
    for (const s of sessions) {
      for (const a of s.attempts) {
        const review = await ipc.getAttemptReview(a.id);
        for (const rev of review.revisions) {
          for (const ann of rev.annotations) {
            const seg = rev.segments.find((x) => x.id === ann.segmentId);
            expect(seg, ann.id).toBeDefined();
            expect(ann.end).toBeLessThanOrEqual(seg!.text.length);
            expect(ann.start).toBeLessThan(ann.end);
          }
        }
      }
    }
  });

  it("reports missing values as unavailable, never zero", async () => {
    const review = await ipc.getAttemptReview("s-01-a1");
    const fillers = review.metrics.find((m) => m.key === "fillers_reviewed")!;
    expect(fillers.value).toBeNull();
    expect(fillers.unavailableReason).toBeTruthy();
  });

  it("rejects an unknown session with a not_found error", async () => {
    await expect(ipc.getSession("nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("reschedules a phrase after review", async () => {
    const card = await ipc.reviewPhrase("ph-2", "good");
    expect(card.intervalDays).toBe(3);
  });
});
