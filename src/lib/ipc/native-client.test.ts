import { expect, it, vi } from "vitest";
import { sessions } from "./mock-data";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, convertFileSrc: (s: string) => s, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

it("uses native history with filters and validates receipts; real reviews never use mock feedback", async () => {
  vi.resetModules();
  const { createNativeClient } = await import("./native-client");
  const client = createNativeClient();
  native.invoke.mockResolvedValueOnce([sessions[0]]);
  const filter = { query: "clarity", favoritesOnly: true };
  expect(await client.listSessions(filter)).toHaveLength(1);
  expect(native.invoke).toHaveBeenLastCalledWith("list_sessions", { filter });
  native.invoke.mockResolvedValueOnce({ ...sessions[0], conditions: null, exerciseType: null, conditionsUnavailableReason: "Legacy take" });
  expect((await client.getSession("legacy")).conditions).toBeNull();
  native.invoke.mockResolvedValueOnce({ durationMs: -1 });
  await expect(client.getSavedRecording("bad")).rejects.toThrow();
  const count = native.invoke.mock.calls.length;
  await expect(client.getAttemptReview("real")).rejects.toThrow("not connected");
  expect(native.invoke).toHaveBeenCalledTimes(count);
});

it("searches real sessions natively and never mixes in sample sessions", async () => {
  vi.resetModules();
  const { createNativeClient } = await import("./native-client");
  const client = createNativeClient();
  native.invoke.mockResolvedValueOnce([{ kind: "session", id: "real-1", title: "Explaining indexes", excerpt: "Transcript: uh, indexes", href: "/sessions/real-1" }]);
  const hits = await client.searchContent("a");
  expect(native.invoke).toHaveBeenCalledWith("search_content", { query: "a" });
  const sessionHits = hits.filter((h) => h.kind === "session");
  expect(sessionHits.map((h) => h.id)).toEqual(["real-1"]);
  expect(sessions.some((s) => sessionHits.some((h) => h.id === s.id))).toBe(false);
});

it("parses sessions with and without activity settings", async () => {
  vi.resetModules();
  const { createNativeClient } = await import("./native-client");
  const client = createNativeClient();
  const plain = { ...sessions[0], activitySnapshot: null };
  native.invoke.mockResolvedValueOnce(plain);
  expect((await client.getSession(plain.id)).activitySnapshot).toBeNull();
  const run = {
    ...sessions[0],
    activitySnapshot: { version: 1, seed: "ladder-1", groupId: null, params: { speakSeconds: 30 } },
    attempts: sessions[0].attempts.map((a, i) => ({ ...a, step: { index: i + 1, key: i ? "fast" : "slow", promptId: null } })),
  };
  native.invoke.mockResolvedValueOnce(run);
  const parsed = await client.getSession(run.id);
  expect(parsed.activitySnapshot?.params).toEqual({ speakSeconds: 30 });
  expect(parsed.attempts[0].step?.key).toBe("slow");
  native.invoke.mockResolvedValueOnce({ ...run, activitySnapshot: { version: 1, seed: "has space", params: {} } });
  await expect(client.getSession(run.id)).rejects.toThrow();
});

it("reads effort and facts from the native commands", async () => {
  vi.resetModules();
  const { createNativeClient } = await import("./native-client");
  const { default: fixture } = await import("./fixtures/facts-v1.json");
  const client = createNativeClient();
  native.invoke.mockResolvedValueOnce(fixture);
  const facts = await client.getPracticeFacts();
  expect(native.invoke).toHaveBeenLastCalledWith("get_practice_facts", undefined);
  expect(facts.sessions[0].outline).toEqual([true, false, true]);
  expect(facts.takes[0].fillersReviewed).toBe(true);
  native.invoke.mockResolvedValueOnce({ ...fixture, extra: 1 });
  await expect(client.getPracticeFacts()).rejects.toThrow();
  const event = { id: 1, kind: "take_saved", refId: "take-1", localDate: "2026-10-15", sessionId: "session-1", attemptId: "take-1", xp: 10, backfilled: false, createdAt: "2026-10-15T07:31:00.000Z" };
  native.invoke.mockResolvedValueOnce([event]);
  expect(await client.listPracticeEvents("2026-10-01")).toEqual([event]);
  expect(native.invoke).toHaveBeenLastCalledWith("list_practice_events", { from: "2026-10-01" });
  native.invoke.mockResolvedValueOnce(null);
  expect(await client.recordSequenceCompleted(["session-1"], "2026-10-16")).toBeNull();
  expect(native.invoke).toHaveBeenLastCalledWith("record_sequence_completed", { sessionIds: ["session-1"], localDate: "2026-10-16" });
});
