import { afterEach, expect, it, vi } from "vitest";
import type { PracticeContext } from "./client";
import { createMockClient, MOCK_XP } from "./mock-client";
import { sessions } from "./mock-data";

afterEach(() => vi.useRealTimers());

const context: PracticeContext = {
  sessionId: "run-1", exerciseId: "ex-repeat", exerciseVersion: 1, exerciseType: "repeat", prompt: "Explain a habit",
  outline: { point: "", reason: "", example: "" },
  conditions: { familiarity: "familiar", preparationSeconds: 15, targetSeconds: 60, audience: null, followUp: false },
  activity: { version: 1, seed: "ladder-1", params: { speakSeconds: 30 } },
  step: { index: 1, key: "slow" },
};

it("mirrors the native effort amounts", () => {
  expect(Object.values(MOCK_XP).reduce((sum, r) => sum + r.xp, 0)).toBe(387);
  expect(MOCK_XP.phrase_reviewed.dailyCap).toBe(10);
});

it("counts the sample history as backfilled effort", async () => {
  const ipc = createMockClient();
  const events = await ipc.listPracticeEvents();
  expect(events.length).toBeGreaterThan(0);
  expect(events.every((e) => e.backfilled)).toBe(true);
  const counted = sessions.flatMap((s) => s.attempts).filter((a) => a.durationMs >= 10_000 && a.ordinal <= 6).length;
  expect(events.filter((e) => e.kind === "take_saved")).toHaveLength(counted);
});

it("keeps a simulated take's step and settings and awards the take once", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  const ipc = createMockClient();
  await ipc.startRecording({ attemptId: "a1", deviceId: null, idempotencyKey: "k1", title: "Pace ladder", context });
  await vi.advanceTimersByTimeAsync(12_000);
  const stopped = ipc.stopRecording("a1");
  await vi.advanceTimersByTimeAsync(200);
  expect((await stopped).durationMs).toBeGreaterThanOrEqual(12_000);
  const detail = ipc.getSession("run-1");
  await vi.advanceTimersByTimeAsync(200);
  const session = await detail;
  expect(session.activitySnapshot?.seed).toBe("ladder-1");
  expect(session.attempts[0].step).toEqual({ index: 1, key: "slow" });
  const awarded = (await ipc.listPracticeEvents()).filter((e) => e.attemptId === "a1");
  expect(awarded.map((e) => [e.kind, e.xp, e.backfilled])).toEqual([["take_saved", 10, false]]);
});

it("records a finished sequence once and only when it has a take", async () => {
  const ipc = createMockClient();
  const withTakes = sessions.find((s) => s.attemptCount > 0)!;
  await expect(ipc.recordSequenceCompleted(["missing"], "2026-10-16")).resolves.toBeNull();
  const first = await ipc.recordSequenceCompleted([withTakes.id], "2026-10-16");
  const again = await ipc.recordSequenceCompleted([withTakes.id], "2026-10-16");
  expect(first).toMatchObject({ kind: "sequence_completed", xp: 20, localDate: "2026-10-16" });
  expect(again?.id).toBe(first?.id);
  await expect(ipc.recordSequenceCompleted([], "2026-10-16")).rejects.toThrow();
});

it("awards reflections and caps phrase reviews per day", async () => {
  const ipc = createMockClient();
  const session = sessions.find((s) => s.ease == null && !s.takeaway)!;
  await ipc.setSessionReflection(session.id, 4, null);
  await ipc.setSessionReflection(session.id, null, "Pause first");
  const [phrase] = await ipc.listPhrases();
  for (let i = 0; i < 12; i++) await ipc.reviewPhrase(phrase.id, "good");
  const events = await ipc.listPracticeEvents();
  expect(events.filter((e) => e.kind === "reflection_saved" && e.refId === session.id)).toHaveLength(1);
  const reviews = events.filter((e) => e.kind === "phrase_reviewed");
  expect(reviews).toHaveLength(12);
  expect(reviews.filter((e) => e.xp > 0)).toHaveLength(10);
});

it("builds facts from the sample history and leaves out Trash", async () => {
  const ipc = createMockClient();
  const before = await ipc.getPracticeFacts();
  expect(before.sessions.length).toBeGreaterThan(1);
  expect(before.takes.every((t) => before.sessions.some((s) => s.id === t.sessionId))).toBe(true);
  const gone = before.sessions[0].id;
  await ipc.moveSessionToTrash(gone);
  const after = await ipc.getPracticeFacts();
  expect(after.sessions.some((s) => s.id === gone)).toBe(false);
  expect(after.takes.some((t) => t.sessionId === gone)).toBe(false);
});
