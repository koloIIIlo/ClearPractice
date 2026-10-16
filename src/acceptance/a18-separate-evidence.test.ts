/**
 * A-18: unfamiliar first attempts, rehearsal and real-conversation feedback
 * stay separate. Progress keeps rehearsed and unfamiliar sessions in their own
 * views; an unfamiliar task's evidence is its first take, never a retry; real
 * conversations are only reflections; stage advancement counts only
 * unfamiliar sessions.
 */
import { expect, it, vi } from "vitest";
import { PROMPTS } from "@/content/prompts";
import { sessions } from "@/lib/ipc/mock-data";
import type { SessionDetail } from "@/lib/ipc/schemas";
import { schedule, STAGES, type ProgressionEvent } from "@/lib/scheduler";
import { buildProgress, evidenceTakes } from "@/lib/today-plan";
import { factsBuilder } from "@/test/fixtures/facts";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, convertFileSrc: (s: string) => s, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const base = structuredClone(sessions[0]) as SessionDetail;
const attempt = (id: string, ordinal: number) => ({ ...base.attempts[0], id, ordinal, firstTake: ordinal === 1, captureState: "saved" as const, audioUnavailableReason: null });
const session = (id: string, familiarity: "familiar" | "unfamiliar", takes: number, extra: Partial<SessionDetail> = {}): SessionDetail => ({
  ...base, id, status: "completed", attemptCount: takes, localDate: "2026-10-12", startedAt: `2026-10-12T0${takes}:00:00.000Z`,
  conditions: { ...base.conditions!, familiarity }, attempts: Array.from({ length: takes }, (_, i) => attempt(`${id}-t${i + 1}`, i + 1)), ...extra,
});

it("keeps an unfamiliar task's first take as its evidence; a retry is rehearsal and never stands in for it", () => {
  const takes = [{ id: "t1", firstTake: true }, { id: "t2", firstTake: false }, { id: "t3", firstTake: false }];
  expect(evidenceTakes("unfamiliar", takes).map((t) => t.id)).toEqual(["t1"]);
  expect(evidenceTakes("rehearsed", takes).map((t) => t.id)).toEqual(["t3", "t2", "t1"]);
  // The first take was moved to Trash: no unfamiliar evidence remains, rather than a retry.
  expect(evidenceTakes("unfamiliar", takes.slice(1))).toEqual([]);
});

it("Progress reads each view from its own sessions, with an unfamiliar first take's pace and never a retake's (native)", async () => {
  vi.resetModules();
  const { createNativeClient } = await import("@/lib/ipc/native-client");
  const details = [session("unfamiliar-1", "unfamiliar", 2), session("unfamiliar-2", "unfamiliar", 2), session("rehearsed-1", "familiar", 2)];
  // Retakes are faster; unfamiliar-2's first take has too little speech for a pace.
  const paces: Record<string, number | null> = {
    "unfamiliar-1-t1": 100, "unfamiliar-1-t2": 140, "unfamiliar-2-t1": null, "unfamiliar-2-t2": 150, "rehearsed-1-t1": 110, "rehearsed-1-t2": 150,
  };
  // Progress reads one facts snapshot (8.6): the same sessions, takes and paces.
  let b = factsBuilder("2026-10-12");
  for (const d of details) {
    b = b.session({ id: d.id, familiarity: d.conditions!.familiarity, startedAt: d.startedAt });
    for (const a of d.attempts) b = b.take({ id: a.id, transcribed: true, paceWpm: paces[a.id] });
  }
  const facts = b.build();
  native.invoke.mockImplementation(async (command: string, args: Record<string, string>) => {
    if (command === "get_practice_facts") return facts;
    if (command === "get_session") return details.find((d) => d.id === args.sessionId);
    throw new Error(`unexpected ${command}`);
  });
  const client = createNativeClient();
  const unfamiliar = await client.getProgress("unfamiliar");
  expect(Object.fromEntries(unfamiliar.points.map((p) => [p.sessionId, p.estimatedPaceWpm]))).toEqual({ "unfamiliar-1": 100, "unfamiliar-2": null });
  const rehearsed = await client.getProgress("rehearsed");
  expect(rehearsed.points.map((p) => [p.sessionId, p.estimatedPaceWpm])).toEqual([["rehearsed-1", 150]]);
  const real = await client.getProgress("real");
  expect([real.completedSessions, real.points]).toEqual([0, []]);
});

it("keeps rehearsed, unfamiliar and real-conversation evidence apart in the summaries", () => {
  const all = [session("u", "unfamiliar", 1), session("r", "familiar", 3, { takeaway: "Lead with the point." }), session("i", "unfamiliar", 1, { status: "interrupted" })];
  const rehearsed = buildProgress("rehearsed", all);
  const unfamiliar = buildProgress("unfamiliar", all);
  expect(rehearsed.points.map((p) => p.sessionId)).toEqual(["r"]);
  expect(unfamiliar.points.map((p) => p.sessionId)).toEqual(["u"]);
  expect(unfamiliar.highlight).toBeNull(); // the rehearsed session's takeaway is not unfamiliar evidence
  expect(buildProgress("real", all)).toMatchObject({ completedSessions: 0, practiceMinutes: 0, points: [] }); // reflections only
});

it("counts only unfamiliar sessions toward a harder stage; rehearsing the same task does not", () => {
  const at2: ProgressionEvent[] = [{ kind: "advance", stageFrom: 1, stageTo: 2, reason: "", createdAt: "2026-10-01T00:00:00.000Z" }];
  const prompt = PROMPTS.find((p) => STAGES[1].matches(p))!;
  const run = (familiarity: "familiar" | "unfamiliar") =>
    ["c", "b", "a"].map((id, i) => session(id, familiarity, 1, { contentId: prompt.id, ease: 4, localDate: `2026-10-0${5 - i}`, startedAt: `2026-10-0${5 - i}T10:00:00.000Z` }));
  expect(schedule({ recent: run("unfamiliar"), events: at2, prompts: PROMPTS }).offer?.to.stage).toBe(3);
  const rehearsed = schedule({ recent: run("familiar"), events: at2, prompts: PROMPTS });
  expect(rehearsed.offer).toBeNull();
  expect(rehearsed.evidence).toMatch(/^0 unfamiliar sessions/);
});
