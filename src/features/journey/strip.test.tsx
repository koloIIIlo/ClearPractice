import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { IpcClient } from "@/lib/ipc";
import { DEFAULT_PREFERENCES, type PracticeEvent } from "@/lib/ipc/schemas";
import { toLocalDate } from "@/lib/phrase-schedule";
import { computeBaselines } from "@/lib/engagement/criteria";
import { evaluateAreas } from "@/lib/engagement/evaluate";
import { recommendation } from "@/lib/engagement/unlocks";
import { validateUnlockInput } from "@/lib/engagement/validate";
import { areaSuggestion } from "@/lib/engagement/suggestion";
import { factsBuilder } from "@/test/fixtures/facts";
import { expectNoScores } from "@/test/no-scores";
import { renderWithApp } from "@/test/render";
import { WeekRow } from "@/features/today/WeekRow";
import { EarnedToday } from "./EarnedToday";
import { JourneyStrip } from "./JourneyStrip";

const today = toLocalDate(new Date());
const event = (kind: string, xp: number, id: number): PracticeEvent => ({ id, kind, refId: `${kind}-${id}`, localDate: today, sessionId: null, attemptId: null, xp, backfilled: false, createdAt: new Date().toISOString() });

function playful(over: Partial<IpcClient> = {}, calm = false): IpcClient {
  const base = createMockClient();
  const facts = factsBuilder(today).session({ familiarity: "unfamiliar" }).take().build();
  const client: IpcClient = { ...base, getPracticeFacts: async () => facts, ...over };
  void client.setPreferences({ ...DEFAULT_PREFERENCES, practiceStyle: calm ? "calm" : "playful" });
  return client;
}

describe("Today strip and Today you earned (9.14)", () => {
  it("shows goal, quests and the nearest next level", async () => {
    const client = playful();
    await client.setWeeklyQuests(
      (() => { const d = new Date(); const back = (d.getDay() + 6) % 7; d.setDate(d.getDate() - back); return toLocalDate(d); })(),
      [{ slot: 1, quest: "unfamiliar-2", params: { area: "spontaneity" } }, { slot: 2, quest: "real-1", params: {} }, { slot: 3, quest: "phrases-10", params: {} }],
    );
    renderWithApp(<JourneyStrip />, { client });
    const strip = await screen.findByRole("region", { name: "Journey this week" });
    expect(strip).toHaveTextContent(/of 3 days/);
    expect(within(strip).getByText("Answer 2 unfamiliar questions")).toBeInTheDocument();
    expect(within(strip).getByRole("link", { name: /Spontaneity 1/ })).toHaveAttribute("href", "/journey?area=spontaneity");
    expect(within(strip).getByRole("link", { name: "Open Journey" })).toBeInTheDocument();
    expectNoScores();
  });

  it("is absent in calm style", async () => {
    renderWithApp(<><JourneyStrip /><p>Today</p></>, { client: playful({}, true) });
    await screen.findByText("Today");
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole("region", { name: "Journey this week" })).not.toBeInTheDocument();
  });

  it("lists today's unlocks in order", async () => {
    const client = playful({ listPracticeEvents: async () => [event("take_saved", 10, 1), event("retake", 5, 2), event("level_reached", 50, 3)] });
    await client.recordUnlocks({
      levels: [{ area: "spontaneity", level: 1, definitionVersion: 1, evidence: {} }],
      achievements: [{ id: "unfamiliar-first", definitionVersion: 1, evidence: {} }],
      records: [], questsDone: [], weeklyGoal: null, localDate: today,
    });
    renderWithApp(<EarnedToday />, { client });
    const panel = await screen.findByRole("region", { name: "Today you earned" });
    expect(panel).toHaveTextContent("+65 XP");
    const items = within(panel).getAllByRole("listitem").map((li) => li.textContent?.trim());
    expect(items).toEqual(["Spontaneity reached level 1 · First unknown", "Into the unknown"]);
    expectNoScores();
  });

  it("shows the goal ring in playful style and plain dots in calm", async () => {
    const view = renderWithApp(<WeekRow today={today} />, { client: playful() });
    await waitFor(() => expect(screen.getByRole("region", { name: "Your week" })).toHaveTextContent(/of 3 days/));
    view.unmount();
    renderWithApp(<WeekRow today={today} />, { client: playful({}, true) });
    const week = await screen.findByRole("region", { name: "Your week" });
    await new Promise((r) => setTimeout(r, 300));
    expect(week).not.toHaveTextContent(/of 3 days/);
  });
});

describe("suggestions, soft locks and validation (9.3, 9.15)", () => {
  it("suggests the least-practised area with its reason", () => {
    const facts = factsBuilder().session({ exerciseType: "imitate" }).take().build();
    const areas = evaluateAreas(facts, [], { today: facts.today, baselines: computeBaselines(facts), promptTags: {} });
    const activity = { structure: 3, fluency: 2, voice: 0, spontaneity: 4, vocabulary: 1, listening: 5, storytelling: 2, courage: 1 };
    const s = areaSuggestion(areas, activity)!;
    expect([s.area, s.text, s.reason]).toEqual(["voice", "Give Voice & delivery five minutes today: Review a take", "It has had the least practice in the last 30 days."]);
  });

  it("never blocks, only recommends", () => {
    expect(recommendation("jam", [])).toBeNull();
  });

  it("validates unlocks like the native core", async () => {
    expect(() => validateUnlockInput({ levels: [{ area: "fluency", level: 2, definitionVersion: 1, evidence: {} }], achievements: [], records: [], questsDone: [], weeklyGoal: null, localDate: "2026-10-16" }, new Set())).toThrow("Level 2 of fluency comes after level 1.");
    expect(() => validateUnlockInput({ levels: [], achievements: [{ id: "first-take", definitionVersion: 1, evidence: { note: "I was nervous" } }], records: [], questsDone: [], weeklyGoal: null, localDate: "2026-10-16" }, new Set())).toThrow("Evidence holds IDs and numbers only.");
    expect(() => validateUnlockInput({ levels: [], achievements: [], records: [{ record: "longest_run", value: 3, unit: "s", attemptId: null, sessionId: null, definitionVersion: 1 }], questsDone: [], weeklyGoal: null, localDate: "2026-10-16" }, new Set())).toThrow("Unknown personal record.");
    expect(() => validateUnlockInput({ levels: [], achievements: [], records: [], questsDone: [], weeklyGoal: "2026-10-14", localDate: "2026-10-16" }, new Set())).toThrow("A week starts on a Monday or a Sunday.");
    const client = createMockClient();
    await expect(client.recordUnlocks({ levels: [{ area: "fluency", level: 2, definitionVersion: 1, evidence: {} }], achievements: [], records: [], questsDone: [], weeklyGoal: null, localDate: "2026-10-16" })).rejects.toThrow("comes after level 1");
    const first = await client.recordUnlocks({ levels: [], achievements: [], records: [{ record: "longest_run", value: 11, unit: "words", attemptId: null, sessionId: null, definitionVersion: 1 }], questsDone: [], weeklyGoal: "2026-10-12", localDate: "2026-10-16" });
    expect([first.records[0].previous, first.weeklyGoal, first.xp]).toEqual([null, "2026-10-12", 50]);
    const better = await client.recordUnlocks({ levels: [], achievements: [], records: [{ record: "longest_run", value: 14, unit: "words", attemptId: null, sessionId: null, definitionVersion: 1 }], questsDone: [], weeklyGoal: "2026-10-12", localDate: "2026-10-16" });
    expect([better.records[0].previous, better.weeklyGoal, better.xp]).toEqual([11, null, 25]);
  });
});
