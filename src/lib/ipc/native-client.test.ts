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
  expect(native.invoke).toHaveBeenLastCalledWith("search_content", { query: "a" });
  const sessionHits = hits.filter((h) => h.kind === "session");
  expect(sessionHits.map((h) => h.id)).toEqual(["real-1"]);
  expect(sessions.some((s) => sessionHits.some((h) => h.id === s.id))).toBe(false);
});
