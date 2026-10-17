/**
 * A-26: the game layer shows no score, grade, percentage or mood next to any
 * speech value. A-27: Calm style hides every game element and loses nothing;
 * switching back shows everything again. A-37 (motion part): celebrations and
 * Sprout don't animate under reduced motion.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import App from "@/App";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { IpcClient } from "@/lib/ipc";
import { DEFAULT_PREFERENCES } from "@/lib/ipc/schemas";
import { ACHIEVEMENTS } from "@/lib/engagement/achievements";
import { LEVELS } from "@/lib/engagement/skills";
import { QUEST_TEMPLATES } from "@/lib/engagement/quests";
import { RECORDS } from "@/lib/engagement/records";
import { celebrationsFrom } from "@/features/engagement/celebrations";
import { factsBuilder } from "@/test/fixtures/facts";
import { expectNoScores, offending } from "@/test/no-scores";
import { renderWithApp } from "@/test/render";
import { JourneyPage } from "@/features/journey/JourneyPage";
import { AchievementsPage } from "@/features/journey/AchievementsPage";
import { Companion } from "@/features/journey/Companion";

afterEach(() => {
  window.location.hash = "#/";
});

const history = () => {
  let b = factsBuilder();
  for (let day = 6; day >= 1; day -= 1)
    b = b.onDay(day).session({ familiarity: day % 2 ? "unfamiliar" : "familiar", outline: [true, true, true] }).take({ transcribed: true, fillersReviewed: true, words: 120, fillersConfirmed: 2, longestRun: 10 + day, speechSpanMs: 65_000 });
  return b.build();
};

it("A-26 the game layer's text, pages and celebrations carry no score words", async () => {
  // Every definition the game layer can show.
  const texts = [
    ...Object.values(LEVELS).flat().flatMap((l) => [l.name, l.description, ...l.criteria.map((c) => c.label)]),
    ...ACHIEVEMENTS.flatMap((a) => [a.title, a.description]),
    ...QUEST_TEMPLATES.map((q) => q.title),
    ...RECORDS.map((r) => r.title),
  ];
  expect(texts.flatMap((t) => offending(t))).toEqual([]);
  const celebration = celebrationsFrom(
    { levels: [{ area: "fluency", level: 3, definitionVersion: 1, evidence: {}, achievedAt: "x" }], achievements: [], records: [{ id: 2, record: "longest_run", value: 14, unit: "words", previous: 11, attemptId: null, sessionId: null, definitionVersion: 1, achievedAt: "x" }], questsDone: [], weeklyGoal: "2026-10-12", xp: 0 },
    { goal: { days: 3, goal: 3, weeksInARow: 1 } },
  );
  expect(celebration.flatMap((c) => offending(`${c.headline}. ${c.because ?? ""}`))).toEqual([]);
  const client: IpcClient = { ...createMockClient(), getPracticeFacts: async () => history() };
  const journey = renderWithApp(<JourneyPage />, { client, path: "/journey" });
  await screen.findAllByRole("button", { name: /level \d of 5/ });
  expectNoScores();
  expect(document.body.textContent).not.toMatch(/\d+\s?%/);
  journey.unmount();
  renderWithApp(<AchievementsPage />, { client });
  await screen.findByRole("heading", { name: "Getting started" });
  expectNoScores();
});

it("A-27 calm style hides every game element and loses nothing", async () => {
  const client: IpcClient = { ...createMockClient(), getPracticeFacts: async () => history() };
  await client.setPreferences({ ...DEFAULT_PREFERENCES, onboarded: true, tourDone: true, styleChosen: true, practiceStyle: "calm" });
  // Something was earned before switching to Calm.
  await client.recordUnlocks({ levels: [{ area: "structure", level: 1, definitionVersion: 1, evidence: {} }], achievements: [{ id: "first-take", definitionVersion: 1, evidence: {} }], records: [], questsDone: [], weeklyGoal: null, localDate: "2026-10-12" });
  window.location.hash = "#/";
  const view = render(<App client={client} />);
  await screen.findByRole("heading", { level: 1 }, { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 800));
  const sidebar = screen.getAllByRole("navigation").find((n) => within(n).queryByRole("link", { name: /Progress/ }))!;
  expect(within(sidebar).queryByRole("link", { name: /Journey/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Journey this week" })).not.toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/\bXP\b/);
  view.unmount();
  // Back to Playful: everything is still there.
  await client.setPreferences({ ...(await client.getPreferences()), practiceStyle: "playful" });
  const state = await client.getEngagementState("2026-10-12");
  // Calm kept recording (nothing is lost), and what was earned before is untouched.
  expect(state.levels).toContainEqual(expect.objectContaining({ area: "structure", level: 1 }));
  expect(state.achievements.map((a) => a.id)).toContain("first-take");
  window.location.hash = "#/";
  render(<App client={client} />);
  await waitFor(() => expect(screen.getAllByRole("link", { name: /Journey/ }).length).toBeGreaterThan(0), { timeout: 8000 });
}, 30_000);

it("A-37 Sprout sways only when on screen and never under reduced motion", async () => {
  const media = window.matchMedia;
  const observer = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  // On screen at once.
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() { this.cb([{ isIntersecting: true }]); }
    disconnect() {}
  };
  const motion = (reduce: boolean) =>
    (window.matchMedia = ((q: string) => ({ matches: reduce && q.includes("reduce"), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia);
  try {
    motion(false);
    const moving = render(<Companion stage={5} />);
    await waitFor(() => expect(moving.container.querySelector(".animate-sway")).not.toBeNull());
    moving.unmount();
    motion(true);
    const still = render(<Companion stage={5} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(still.container.querySelector(".animate-sway")).toBeNull();
  } finally {
    window.matchMedia = media;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = observer;
  }
});
