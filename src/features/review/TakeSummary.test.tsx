import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { DEFAULT_PREFERENCES, type AttemptTranscript, type CoachingRun, type TranscriptMeasures } from "@/lib/ipc/schemas";
import { expectNoScores } from "@/test/no-scores";
import { factsBuilder } from "@/test/fixtures/facts";
import { createPlayerLink } from "./player-link";
import { summarizeTake, TakeSummary } from "./TakeSummary";

const filler = (word: string, decision: "confirmed" | "dismissed" | null = null) => ({ segment: 0, word, segmentStartMs: 0, wordStartMs: null, wordEndMs: null, decision });

function transcript(measures: Partial<TranscriptMeasures>, extra: Partial<AttemptTranscript> = {}): AttemptTranscript {
  return {
    attemptId: "take-1",
    revision: {
      id: "rev-1", source: "local", provider: null, modelId: "large-v3-turbo", backend: "cpu", prompt: null, language: "en",
      text: "…", workerElapsedMs: 4000, createdAt: "2026-10-10T08:00:00Z", segments: [],
      measures: {
        definitionVersion: 1, source: "Estimated", wordCount: 40, speechSpanMs: 21_000, paceWpm: 114, paceUnavailableReason: null,
        pauseThresholdMs: 700, pauses: [], pausesUnavailableReason: null, fillers: [], repeatedWords: [], untimedSegments: 0, voice: null,
        ...measures,
      },
    },
    correction: null,
    job: null,
    ...extra,
  };
}

const run = (revisionId: string): CoachingRun => ({
  id: "run-1", attemptId: "take-1", revisionId, provider: "OpenAI", model: "gpt-6-luna", payloadSha256: "a".repeat(64),
  sentText: "…", transcriptText: "…", deliveryImpressions: false,
  feedback: { summary: "Your example made the point concrete.", oneImprovement: "Say the main point first.", nextAttempt: "Open with “I want to stop …”.", corrections: [], phrases: [], deliveryNotes: [] },
  inputTokens: 300, outputTokens: 120, estimatedCostMicroUsd: 400, costUnavailableReason: null, createdAt: "2026-10-10T08:05:00Z",
});

describe("summarizeTake", () => {
  it("says why instead of inventing feedback when there is no transcript or too little of one", () => {
    expect(summarizeTake(null)).toMatchObject({ kind: "none", reason: expect.stringMatching(/once this take has a transcript/) });
    expect(summarizeTake(transcript({ wordCount: 0 }))).toMatchObject({ kind: "none", reason: expect.stringMatching(/No words were transcribed/) });
    expect(summarizeTake(transcript({ wordCount: 9 }))).toMatchObject({ kind: "none", reason: expect.stringMatching(/9 words, too few/) });
  });

  it("leads with what went well from the measures, labelled Estimated, and finds nothing to try when nothing stands out", () => {
    expect(summarizeTake(transcript({ fillers: [filler("um", "dismissed")] }))).toEqual({
      kind: "ready", fromAi: false, stale: false,
      wentWell: { text: "No filler candidates in 40 words.", source: "estimated" },
      tryNext: null,
    });
    // Two fillers don't stand out; the finished take is the positive.
    expect(summarizeTake(transcript({ fillers: [filler("um"), filler("uh")] }))).toMatchObject({
      wentWell: { text: "You finished the take: 40 words in 0:21." }, tryNext: null,
    });
  });

  it("suggests a pause instead of fillers when several candidates remain after your review", () => {
    const result = summarizeTake(transcript({ fillers: [filler("um"), filler("uh", "confirmed"), filler("um"), filler("like", "dismissed")], speechSpanMs: null }));
    expect(result).toMatchObject({
      kind: "ready",
      wentWell: { text: "You finished the take: 40 words.", source: "estimated" },
      tryNext: { text: "Pause between ideas instead of filling the gap", detail: "3 filler candidates (“um”, “uh”). A short silent pause can take their place.", source: "estimated" },
    });
  });

  it("uses saved AI feedback for both points, marked stale when the transcript changed since", () => {
    expect(summarizeTake(transcript({}), [run("rev-1")])).toEqual({
      kind: "ready", fromAi: true, stale: false,
      wentWell: { text: "Your example made the point concrete.", source: "ai" },
      tryNext: { text: "Say the main point first.", detail: "Open with “I want to stop …”.", source: "ai" },
    });
    const corrected = transcript({}, { correction: { id: "rev-2", parentId: "rev-1", text: "…", createdAt: "x", fillerCount: 0, wordCount: 40 } });
    expect(summarizeTake(corrected, [run("rev-1")])).toMatchObject({ stale: true });
  });
});

function setup(overrides: Partial<IpcClient>, link = createPlayerLink()) {
  const client: IpcClient = {
    ...createMockClient(), recordingMode: "native", listTakeCoaching: async () => [],
    getAudioMeasures: async (attemptId) => ({ attemptId, method: "nuclei-v1", syllables: 240, spanMs: 58_000, phonationMs: 50_000, rateSps: 4.14, articulationSps: 4.8, unavailableReason: null }),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IpcContext.Provider value={client}>
          <TakeSummary attemptId="take-1" reviewHref="/sessions/s-1/attempt/1" link={link} />
        </IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("TakeSummary", () => {
  it("shows what went well before one thing to try, each with its provenance", async () => {
    setup({ getAttemptTranscript: async () => transcript({ fillers: [filler("um"), filler("uh"), filler("um")] }) });
    const region = await screen.findByRole("group", { name: "Take summary" });
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent?.trim());
    expect(headings).toEqual(["What went well", "One thing to try"]);
    expect(region).toHaveTextContent("You finished the take: 40 words in 0:21.");
    expect(region).toHaveTextContent("Pause between ideas instead of filling the gap");
    // What went well, one thing to try and the Flow measures.
    expect(screen.getAllByText("Estimated")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "ask for AI feedback in the session" })).toHaveAttribute("href", "/sessions/s-1/attempt/1");
  });

  it("waits for the transcript and says so while it runs", async () => {
    setup({ getAttemptTranscript: async () => ({ attemptId: "take-1", revision: null, correction: null, job: { id: "j", state: "running", errorMessage: null, createdAt: null, finishedAt: null } }) });
    expect(await screen.findByText("The summary appears here when the transcript is ready.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Take summary" })).not.toBeInTheDocument();
  });

  it("explains in the browser preview that a simulated take has nothing to summarise", () => {
    setup({ recordingMode: "simulated" });
    expect(screen.getByText(/Browser preview: a simulated take has no transcript/)).toBeInTheDocument();
  });
});

/** Measures v2 (8.1) for a 60-word take with three pauses. */
const v2: Partial<TranscriptMeasures> = {
  definitionVersion: 2, wordCount: 60,
  pauses: [{ afterSegment: 0, startMs: 3_000, durationMs: 900 }, { afterSegment: 1, startMs: 9_000, durationMs: 800 }, { afterSegment: 2, startMs: 14_000, durationMs: 1_100 }],
  pauseKinds: ["boundary", "boundary", "mid_clause"],
  runs: { meanWords: 7.4, longestWords: 14, longestFromSegment: 1, longestToSegment: 2, count: 4 }, runsUnavailableReason: null,
  watchWords: [{ word: "actually", count: 2, segments: [0, 2] }, { word: "you know", count: 1, segments: [1] }],
  hedges: [{ word: "maybe", count: 2, segments: [0] }, { word: "i think", count: 2, segments: [1] }],
  wordsUnavailableReason: null, differentPer50: 37.2, vocabularyUnavailableReason: null,
  opener: { text: "Um, so the first thing I do is plan.", segment: 0, hint: "starts_with_hesitation" },
  ending: { text: "That is why planning saves me time.", segment: 3, hint: null },
};
const segments = ["Um, so the first thing I do is plan.", "So the first thing in the morning I write down three tasks", "and I lost track of the time", "That is why planning saves me time."].map((text, i) => ({
  text, startMs: i * 5_000, endMs: i * 5_000 + 3_000, timingSource: "Estimated" as const, timingUnavailableReason: null,
}));
const withSegments = (measures: Partial<TranscriptMeasures>) => {
  const t = transcript(measures);
  return { ...t, revision: { ...t.revision!, segments } };
};

describe("take summary v2 (8.3)", () => {
  it("shows runs and pause location with the Estimated label", async () => {
    setup({ getAttemptTranscript: async () => withSegments(v2) });
    const flow = (await screen.findByText("Flow")).closest("details")!;
    expect(flow).toHaveAttribute("open");
    expect(flow).toHaveTextContent("Mean run 7.4 words between pauses");
    expect(flow).toHaveTextContent("Longest 14");
    expect(flow).toHaveTextContent("Pauses: 2 between clauses, 1 inside one");
    expect(within(flow).getByText("Estimated")).toBeInTheDocument();
    expect(await within(flow).findByText("Speech rate (audio) about 4.1 syllables a second")).toBeInTheDocument();
    const words = screen.getByText("Words").closest("details")!;
    expect(words).toHaveTextContent("actually 2");
    expect(words).toHaveTextContent("Hedges: 4");
    expect(words).toHaveTextContent("Different words: 37 in every 50");
    expectNoScores();
  });

  it("leads with the longest run, then with pauses that all fell between thoughts", () => {
    expect(summarizeTake(withSegments({ ...v2, pauseKinds: ["boundary", "boundary", "boundary"] }))).toMatchObject({
      wentWell: { text: "Your longest run: 14 words between pauses, from “So the first thing…”.", source: "estimated" },
    });
    const short = { ...v2, runs: { ...v2.runs!, longestWords: 9 }, pauseKinds: ["boundary", "boundary", "boundary"] as ("boundary" | "mid_clause")[] };
    expect(summarizeTake(withSegments(short))).toMatchObject({ wentWell: { text: "Every pause fell between thoughts (3 pauses)." } });
    expect(summarizeTake(withSegments(v2), [], { phrasesUsed: ["lose track of time"] })).toMatchObject({ wentWell: { text: "You used a saved phrase: “lose track of time”." } });
  });

  it("suggests pausing between thoughts when two pauses fell inside a clause", () => {
    expect(summarizeTake(withSegments({ ...v2, pauseKinds: ["mid_clause", "boundary", "mid_clause"] }))).toMatchObject({
      tryNext: { text: "Pause at the end of a thought, not in the middle", detail: "2 pauses fell inside a clause.", source: "estimated" },
    });
    // One inside a clause: the hesitant opening comes next, then a trailing ending, then a word used often.
    expect(summarizeTake(withSegments(v2))).toMatchObject({ tryNext: { text: "Try opening with your point", detail: "Your opening: “Um, so the first thing I do is plan.”" } });
    const clearStart = { ...v2, opener: { ...v2.opener!, hint: null } };
    expect(summarizeTake(withSegments({ ...clearStart, ending: { text: "…so yeah.", segment: 3, hint: "trails_off" } }))).toMatchObject({ tryNext: { text: "Try finishing with one sentence that sums up" } });
    const like = [{ word: "like", count: 4, segments: [0] }];
    expect(summarizeTake(withSegments(clearStart), [], { watchWords: like })).toMatchObject({
      tryNext: { text: "Notice how often you say “like”", detail: "4 times in this take. This counts every “like”, including ordinary uses." },
    });
  });

  it("hides Words when the take has fewer than 20 words, with the reason", async () => {
    setup({
      getAttemptTranscript: async () =>
        withSegments({ ...v2, wordCount: 18, watchWords: [], hedges: [], wordsUnavailableReason: "Needs at least 20 words.", differentPer50: null, vocabularyUnavailableReason: "Needs at least 50 words." }),
    });
    const words = (await screen.findByText("Words")).closest("details")!;
    expect(words).toHaveTextContent("Words you use often and hedges unavailable (Needs at least 20 words.)");
    expect(words).not.toHaveTextContent("Hedges:");
  });

  it("lists saved phrases spotted in the take", async () => {
    const user = userEvent.setup();
    const link = createPlayerLink();
    const seeks: [number, boolean | undefined][] = [];
    link.attach((ms, play) => seeks.push([ms, play]));
    setup(
      {
        getAttemptTranscript: async () => withSegments(v2),
        listPhraseUses: async () => [{ phraseId: "phrase-1", attemptId: "take-1", sessionId: "s-1", revisionId: "rev-1", segment: 2, localDate: "2026-10-16" }],
        listPhrases: async () => [{ id: "phrase-1", original: "I forgot the time", expression: "lose track of time", explanation: "", examples: [], dueDate: "2026-10-16", intervalDays: 0, sourceSessionId: null }],
      },
      link,
    );
    const phrase = await screen.findByRole("link", { name: "“lose track of time”" });
    expect(phrase).toHaveAttribute("href", "/phrases?focus=phrase-1");
    expect(screen.getByText("Matched by words, so a different meaning can match too.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Listen" }));
    expect(seeks).toEqual([[10_000, true]]);
    expect(screen.getByRole("group", { name: "Take summary" })).toHaveTextContent("You used a saved phrase: “lose track of time”.");
  });

  it("shows measures on request (11.4)", async () => {
    const user = userEvent.setup();
    setup({
      getAttemptTranscript: async () => withSegments(v2),
      getPreferences: async () => ({ ...DEFAULT_PREFERENCES, measuresTiming: "on_request" }),
    });
    const region = await screen.findByRole("group", { name: "Take summary" });
    // What went well and the self-check stay; Flow and Words wait for you.
    expect(within(region).getByText("What went well")).toBeInTheDocument();
    expect(within(region).getByRole("region", { name: "Quick self-check" })).toBeInTheDocument();
    expect(within(region).queryByText("Flow")).toBeNull();
    expect(within(region).queryByText("Words")).toBeNull();
    await user.click(within(region).getByRole("button", { name: "Show measures" }));
    expect(within(region).getByText("Flow")).toBeInTheDocument();
    expect(within(region).getByText("Words")).toBeInTheDocument();
  });

  it("fades measures after five takes with the same focus once Fluency reaches 3 (11.4)", async () => {
    const facts = factsBuilder("2026-10-16").session({ focus: "Pause between ideas instead of filling the gap" });
    for (let i = 0; i < 6; i += 1) facts.take();
    const built = facts.build();
    setup({
      getAttemptTranscript: async () => withSegments(v2),
      getPreferences: async () => ({ ...DEFAULT_PREFERENCES, measuresTiming: "fade" }),
      getPracticeFacts: async () => ({ ...built, takes: built.takes.map((t, i) => (i === 5 ? { ...t, id: "take-1" } : t)) }),
      getEngagementState: async () => ({ levels: [{ area: "fluency", level: 3, definitionVersion: 1, evidence: [], achievedAt: "2026-10-10T08:00:00.000Z" }], achievements: [], records: [], quests: [], goalWeeks: [] }),
    });
    expect(await screen.findByRole("button", { name: "Show measures" })).toBeInTheDocument();
    expect(screen.getByText(/Measures fold as you improve/)).toBeInTheDocument();
  });
});
