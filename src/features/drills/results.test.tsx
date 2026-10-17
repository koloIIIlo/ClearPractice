import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROMPTS } from "@/content/prompts";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { IpcClient } from "@/lib/ipc";
import { PracticePrompt, type ActivityResult, type SessionDetail } from "@/lib/ipc/schemas";
import { factsBuilder } from "@/test/fixtures/facts";
import { expectNoScores, offending } from "@/test/no-scores";
import { renderWithApp } from "@/test/render";
import { CountdownRing, lightAt } from "./CountdownRing";
import type { DrillModule, DrillPlan, DrillTake } from "./drill-module";
import jam from "./modules/jam";
import paceLadder from "./modules/pace-ladder";
import emphasis from "./modules/emphasis";
import daily from "./modules/daily";
import threeWays from "./modules/three-ways";
import wordBomb from "./modules/word-bomb";
import storySpine from "./modules/story-spine";
import roulette from "./modules/roulette";
import { DrillComparisonPanel } from "./DrillComparison";
import { DEFAULT_PREFERENCES } from "@/lib/ipc/schemas";

const ctx = { prompts: PROMPTS.map((p) => PracticePrompt.parse(p)), today: "2026-10-20" };
const takesOf = (plan: DrillPlan, durations: number[]): DrillTake[] => durations.map((durationMs, i) => ({ round: plan.rounds[Math.min(i, plan.rounds.length - 1)], attemptId: `take-${i + 1}`, durationMs }));
function withResults(results: Record<string, ActivityResult>, over: Partial<IpcClient> = {}) {
  const base = createMockClient();
  return { ...base, ...over, getActivityResult: vi.fn(async (id: string) => results[id]), setSelfCheck: vi.fn(over.setSelfCheck ?? (async () => {})) } satisfies IpcClient;
}
const Result = (m: DrillModule) => m.Result;
afterEach(() => vi.restoreAllMocks());

describe("drill results (10.2–10.11)", () => {
  it("shows Just a Minute's clean seconds as an estimate, with your best before", async () => {
    const plan = jam.plan("s", {}, ctx);
    const facts = factsBuilder("2026-10-20").onDay(15).session({ exerciseType: "jam" }).take({ durationMs: 60_000, result: { cleanSeconds: 52 } }).build();
    const client = withResults(
      { "take-1": { attemptId: "take-1", definitionVersion: 1, kind: "jam", speakingMs: 59_000, cleanSeconds: 47, hesitations: 3, longPauses: 1, longPauseMs: 2_100, repeats: 2, flags: 1, unavailableReason: null } },
      { getPracticeFacts: async () => facts },
    );
    const R = Result(jam);
    renderWithApp(<R plan={plan} takes={takesOf(plan, [60_000])} sessionId="s1" />, { client });
    expect(await screen.findByText("About 47 clean seconds")).toBeInTheDocument();
    expect(screen.getByText("Estimated")).toBeInTheDocument();
    expect(await screen.findByText(/Your best before: 52 clean seconds/)).toBeInTheDocument();
    expect(screen.getByText("1 (2.1 s)")).toBeInTheDocument();
    expectNoScores();
  });

  it("says what is missing without a transcript instead of showing zero", async () => {
    const plan = jam.plan("s", {}, ctx);
    const client = withResults({ "take-1": { attemptId: "take-1", definitionVersion: 1, kind: "jam", speakingMs: 58_000, cleanSeconds: null, hesitations: null, longPauses: 2, longPauseMs: 4_600, repeats: null, flags: 0, unavailableReason: "Needs a transcript." } });
    const R = Result(jam);
    renderWithApp(<R plan={plan} takes={takesOf(plan, [60_000])} sessionId="s1" />, { client });
    expect(await screen.findByText("Clean seconds need a transcript")).toBeInTheDocument();
    expect(screen.getAllByText("Not available")).toHaveLength(2);
  });

  it("never labels a speed as better in the pace ladder", async () => {
    const plan = paceLadder.plan("s", {}, ctx);
    const rate = (id: string, rateSps: number): ActivityResult => ({ attemptId: id, definitionVersion: 1, kind: "pace_ladder", rateSps, unavailableReason: null });
    const client = withResults({ "take-1": rate("take-1", 3.2), "take-2": rate("take-2", 4.3), "take-3": rate("take-3", 5.1) });
    const R = Result(paceLadder);
    renderWithApp(<R plan={plan} takes={takesOf(plan, [30_000, 30_000, 30_000])} sessionId="s1" />, { client });
    expect(await screen.findByText("Three clearly different speeds · range 1.9")).toBeInTheDocument();
    expect(screen.getByText("Range, not speed: being able to slow down on purpose is the skill.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/too (fast|slow)|better|worse/i);
    expectNoScores();
  });

  it("keeps estimated emphasis hits and your own judgements apart", async () => {
    const plan = emphasis.plan("s", {}, ctx);
    const e = (id: string, hit: boolean | null, aligned: boolean, target: number): ActivityResult => ({
      attemptId: id, definitionVersion: 1, kind: "emphasis", round: 0, target, peakWord: aligned ? (hit ? target : target + 1) : null, hit: aligned ? hit : null, aligned, nuclei: 8, expected: 8, unavailableReason: aligned ? null : "Couldn't line up the beats this time.",
    });
    const targets = (plan.params.targets as string[]).map(Number);
    const client = withResults({ "take-1": e("take-1", true, true, targets[0]), "take-2": e("take-2", false, true, targets[1]), "take-3": e("take-3", null, false, targets[2]) });
    const R = Result(emphasis);
    renderWithApp(<R plan={plan} takes={takesOf(plan, [3_000, 3_000, 3_000])} sessionId="s1" />, { client });
    expect(await screen.findByText(/Estimated: 1 of 3/)).toBeInTheDocument();
    expect(screen.queryByText(/Your judgement/)).not.toBeInTheDocument();
    const yes = await screen.findByRole("radio", { name: "Yes, I stressed it" });
    await waitFor(() => expect(yes).toBeEnabled());
    await userEvent.click(yes);
    await waitFor(() => expect(client.setSelfCheck).toHaveBeenCalledWith("take-3", "stressed_target", true));
    expect(await screen.findByText(/Your judgement: 1 more/)).toBeInTheDocument();
    expect(screen.getByText(/Estimated: 1 of 3/)).toBeInTheDocument();
  });

  it("copies the daily share text with counts and no words of your answer, from the official take", async () => {
    const plan = daily.plan("s", {}, ctx);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const session = { ...(await createMockClient().getSession("s-01")), id: "daily-2026-10-20", attempts: [] } as SessionDetail;
    session.attempts = [
      { id: "official", ordinal: 1, captureState: "saved", analysisState: null, durationMs: 60_000, createdAt: "2026-10-20T08:00:00.000Z", firstTake: true },
      { id: "take-1", ordinal: 2, captureState: "saved", analysisState: null, durationMs: 41_000, createdAt: "2026-10-20T09:00:00.000Z", firstTake: false },
    ];
    const grid: ActivityResult = { attemptId: "official", definitionVersion: 1, kind: "daily", windows: [0, 0, 1, 0, 2, 0], flowing: 4, hesitation: 1, pause: 1, silent: 0, transcribed: true, unavailableReason: null };
    const client = withResults({ official: grid, "take-1": { ...grid, attemptId: "take-1", windows: [3, 3, 3, 3, 3, 3] } }, { getSession: async () => session });
    const R = Result(daily);
    renderWithApp(<R plan={plan} takes={takesOf(plan, [41_000])} sessionId="daily-2026-10-20" />, { client });
    expect(await screen.findByText(/Your latest take was practice/)).toBeInTheDocument();
    expect(await screen.findByText("4 flowing · 1 hesitation · 1 pause")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Copy share text/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = (writeText.mock.calls as unknown as [string][])[0][0];
    expect(text).toBe("ClearPractice Daily #4 · 1:00\n🟩🟩🟨🟩⬜🟩\n4 flowing · 1 hesitation · 1 pause");
    const promptWords = plan.rounds[0].prompt.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    expect(promptWords.filter((w) => text.toLowerCase().includes(w))).toEqual([]);
  });

  it("shows three ways in three columns and saves which version fitted best", async () => {
    const plan = threeWays.plan("s", {}, ctx);
    const basic = (id: string): ActivityResult => ({ attemptId: id, definitionVersion: 1, kind: "basic", durationMs: 50_000, words: 90, speechMs: 48_000, hesitations: 2, differentPer50: 31 });
    const client = withResults({ "take-1": basic("take-1"), "take-2": basic("take-2"), "take-3": basic("take-3") });
    const R = Result(threeWays);
    renderWithApp(<R plan={plan} takes={takesOf(plan, [50_000, 45_000, 40_000]).map((t, i) => ({ ...t, round: plan.rounds[i] }))} sessionId="s1" />, { client });
    await waitFor(() => expect(screen.getAllByText("A 10-year-old")).toHaveLength(2));
    expect(screen.getAllByText("A colleague from another team")).toHaveLength(2);
    await userEvent.click(screen.getByRole("radio", { name: "An expert" }));
    await waitFor(() => expect(client.setSelfCheck).toHaveBeenCalledTimes(3));
    expect(client.setSelfCheck.mock.calls).toEqual([["take-1", "fit_child", null], ["take-2", "fit_colleague", null], ["take-3", "fit_expert", true]]);
  });
});

describe("live views and setup (10.3, 10.4, 10.8)", () => {
  const live = (m: DrillModule) => m.Live!;

  it("shows each bomb word at its time and records a mark once", () => {
    const plan = wordBomb.plan("s", {}, ctx);
    const times = (plan.params.times as string[]).map((t) => Number(t) * 1000);
    const word = (plan.params.words as string[])[0].split("|")[0];
    const mark = vi.fn();
    const Live = live(wordBomb);
    const view = render(<Live plan={plan} round={plan.rounds[0]} speaking elapsedMs={times[0] - 500} mark={mark} />);
    expect(screen.queryByText(word)).not.toBeInTheDocument();
    view.rerender(<Live plan={plan} round={plan.rounds[0]} speaking elapsedMs={times[0] + 100} mark={mark} />);
    expect(screen.getByText(word)).toBeInTheDocument();
    expect(screen.getByText(`New word: ${word}.`)).toBeInTheDocument();
    view.rerender(<Live plan={plan} round={plan.rounds[0]} speaking elapsedMs={times[0] + 900} mark={mark} />);
    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith({ kind: "word_shown", data: { index: 0, word: (plan.params.wordIds as string[])[0] } });
  });

  it("advances story spine cards with the arrow key and records marks", async () => {
    const plan = storySpine.plan("s", {}, ctx);
    const mark = vi.fn();
    const Live = live(storySpine);
    render(<Live plan={plan} round={plan.rounds[0]} speaking elapsedMs={5_000} mark={mark} />);
    expect(screen.getByText("Once upon a time…")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByText("Every day…")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Next card/ }));
    expect(mark.mock.calls.map((c) => c[0])).toEqual([{ kind: "card_advanced", data: { step: 1 } }, { kind: "card_advanced", data: { step: 2 } }]);
  });

  it("announces the roulette category and topic, and spins at once under reduced motion", async () => {
    const media = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
    try {
      const plan = roulette.plan("s", {}, ctx);
      const onReady = vi.fn();
      const Setup = roulette.Setup!;
      renderWithApp(<Setup plan={plan} ctx={ctx} onReady={onReady} />);
      await userEvent.click(screen.getByRole("button", { name: /Spin/ }));
      const live = screen.getByText(plan.rounds[0].prompt).closest("[aria-live]")!;
      expect(within(live as HTMLElement).getByText(/^Category: /)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /Spin again/ }));
      await userEvent.click(screen.getByRole("button", { name: "Use this topic" }));
      expect(onReady.mock.calls[0][0].params.respun).toBe(true);
    } finally {
      window.matchMedia = media;
    }
  });
});

describe("the countdown ring (10.1, 10.3)", () => {
  it("labels the light that is on and changes at 2/3, 11/12 and the full time", () => {
    expect([lightAt(39_000, 60_000), lightAt(40_000, 60_000), lightAt(55_000, 60_000), lightAt(60_000, 60_000)]).toEqual([null, "green", "amber", "red"]);
    render(<CountdownRing totalMs={65_000} remainingMs={20_000} light="green" caption="Time left" />);
    expect(screen.getByText("Green: minimum time reached")).toBeInTheDocument();
    expect(screen.getByLabelText("Time left: 0:20")).toBeInTheDocument();
    expect(offending(document.body.textContent ?? "")).toEqual([]);
    act(() => undefined);
  });
});

describe("the optional AI comparison (10.5, 10.9)", () => {
  const withMode = async (coachingMode: "api" | "local" | "off") => {
    const base = createMockClient();
    const client = { ...base, previewDrillComparison: vi.fn(base.previewDrillComparison), requestDrillComparison: vi.fn(base.requestDrillComparison) } satisfies IpcClient;
    await client.setPreferences({ ...DEFAULT_PREFERENCES, coachingMode });
    return client;
  };

  it("sends nothing until Send, then shows notes that quote your words as an AI suggestion", async () => {
    const client = await withMode("api");
    renderWithApp(<DrillComparisonPanel sessionId="s-01" kind="three_ways" labels={["A 10-year-old", "A colleague", "An expert"]} />, { client });
    await userEvent.click(await screen.findByRole("button", { name: /Preview the request/ }));
    expect(await screen.findByText("Exactly what will be sent")).toBeInTheDocument();
    expect(client.previewDrillComparison).toHaveBeenCalledWith("s-01", "three_ways", DEFAULT_PREFERENCES.coachingModel);
    expect(client.requestDrillComparison).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Send · may be billed/ }));
    expect(await screen.findByText("One thing to try:")).toBeInTheDocument();
    expect(client.requestDrillComparison).toHaveBeenCalledTimes(1);
    expect(screen.getByText("AI suggestion")).toBeInTheDocument();
    expect(screen.getAllByText(/^You said:/).length).toBeGreaterThan(0);
    expectNoScores();
  });

  it("explains instead of sending when Coaching uses the local model, and is absent when off", async () => {
    const local = renderWithApp(<DrillComparisonPanel sessionId="s-01" kind="pitch" labels={["60 seconds", "30 seconds", "15 seconds"]} />, { client: await withMode("local") });
    expect(await screen.findByText(/Coaching is set to your local model, so nothing is sent/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Preview the request/ })).not.toBeInTheDocument();
    local.unmount();
    renderWithApp(<><DrillComparisonPanel sessionId="s-01" kind="pitch" labels={[]} /><p>after</p></>, { client: await withMode("off") });
    await screen.findByText("after");
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByRole("region", { name: "AI comparison" })).not.toBeInTheDocument();
  });
});
