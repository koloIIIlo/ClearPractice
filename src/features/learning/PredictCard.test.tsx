import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { DEFAULT_PREFERENCES, type AttemptTranscript, type Prediction, type Preferences } from "@/lib/ipc/schemas";
import { TakeSummary } from "@/features/review/TakeSummary";
import { factsBuilder } from "@/test/fixtures/facts";
import { renderWithApp } from "@/test/render";

const filler = (word: string) => ({ segment: 0, word, segmentStartMs: 0, wordStartMs: null, wordEndMs: null, decision: null });
const transcript: AttemptTranscript = {
  attemptId: "take-1", correction: null, job: null,
  revision: {
    id: "rev-1", source: "local", provider: null, modelId: "base", backend: "cpu", prompt: null, language: "en", text: "…", workerElapsedMs: 1, createdAt: "2026-10-16T08:00:00Z",
    segments: [{ text: "Um, so I plan first, then I write it down.", startMs: 0, endMs: 9_000, timingSource: "Estimated", timingUnavailableReason: null }],
    measures: {
      definitionVersion: 2, source: "Estimated", wordCount: 64, speechSpanMs: 60_000, paceWpm: 120, paceUnavailableReason: null, pauseThresholdMs: 700,
      pauses: [], pausesUnavailableReason: null, fillers: [filler("um"), filler("uh"), filler("um")], repeatedWords: [], untimedSegments: 0, voice: null,
      pauseKinds: [], runs: { meanWords: 8, longestWords: 16, longestFromSegment: 0, longestToSegment: 0, count: 4 }, runsUnavailableReason: null,
      watchWords: [], hedges: [], wordsUnavailableReason: null, differentPer50: 38, vocabularyUnavailableReason: null, opener: null, ending: null,
    },
  },
};

/** A desktop client with predict-first on; guesses are kept in memory. */
function setup(preferences: Partial<Preferences> = { predictFirst: true }) {
  const saved: Prediction[] = [];
  // Your usual pace is 118 (the median of the other takes), so 120 counts as about usual.
  const facts = factsBuilder("2026-10-16").session().take({ paceWpm: 110 }).take({ paceWpm: 118 }).take({ paceWpm: 126 }).build();
  const client: IpcClient = {
    ...createMockClient(), recordingMode: "native",
    getPreferences: async () => ({ ...DEFAULT_PREFERENCES, ...preferences }),
    listTakeCoaching: async () => [],
    getAttemptTranscript: async () => transcript,
    getPracticeFacts: async () => ({ ...facts, takes: [...facts.takes, { ...facts.takes[0], id: "take-1", paceWpm: 120 }] }),
    getAudioMeasures: async (attemptId) => ({ attemptId, method: "nuclei-v1", syllables: null, spanMs: null, phonationMs: null, rateSps: null, articulationSps: null, unavailableReason: "Needs at least 5 seconds of speech." }),
    listPredictions: async () => [...saved],
    setPrediction: vi.fn(async (attemptId, kind, predicted) => {
      saved.push({ attemptId, kind, predicted, createdAt: "2026-10-16T08:02:00Z" });
      return true;
    }),
  };
  renderWithApp(<TakeSummary attemptId="take-1" durationMs={60_000} />, { client });
  return client;
}

describe("predict, then check (11.5)", () => {
  it("hides measures until reveal", async () => {
    const user = userEvent.setup();
    setup();
    const card = await screen.findByRole("group", { name: "Guess first" });
    expect(screen.queryByText("What went well")).toBeNull();
    expect(screen.queryByText("Flow")).toBeNull();
    expect(screen.queryByText(/Hesitation candidates/)).toBeNull();
    const reveal = within(card).getByRole("button", { name: "Reveal" });
    expect(reveal).toBeDisabled();
    await user.click(within(card).getByRole("radio", { name: "2–4" }));
    await user.click(within(card).getByRole("radio", { name: "About usual" }));
    await user.click(reveal);
    expect(await screen.findByText("What went well")).toBeInTheDocument();
    expect(screen.getByText(/Hesitation candidates 3/)).toBeInTheDocument();
  });

  it("labels the guess Your note and the value Estimated", async () => {
    const user = userEvent.setup();
    const client = setup();
    const card = await screen.findByRole("group", { name: "Guess first" });
    await user.click(within(card).getByRole("radio", { name: "2–4" }));
    await user.click(within(card).getByRole("radio", { name: "Faster" }));
    await user.click(within(card).getByRole("button", { name: "Reveal" }));
    const guesses = await screen.findByRole("list", { name: "Your guesses" });
    const [hesitations, pace] = within(guesses).getAllByRole("listitem");
    expect(hesitations).toHaveTextContent(/^Hesitations: you guessed 2–4\s*Your note\s*·\s*3 hesitation candidates\s*Estimated\s*matched$/);
    expect(pace).toHaveTextContent(/^Pace: you guessed Faster\s*Your note\s*·\s*about usual \(about 120 words a minute; your usual is about 118\)\s*Estimated$/);
    expect(client.setPrediction).toHaveBeenCalledWith("take-1", "hesitations", "2-4");
    expect(client.setPrediction).toHaveBeenCalledWith("take-1", "pace", "faster");
    // The guesses sit outside the measure folds.
    expect(guesses.closest("details")).toBeNull();
  });

  it("Skip shows the summary without saving", async () => {
    const user = userEvent.setup();
    const client = setup();
    const card = await screen.findByRole("group", { name: "Guess first" });
    await user.click(within(card).getByRole("radio", { name: "5 or more" }));
    await user.click(within(card).getByRole("button", { name: "Skip" }));
    expect(await screen.findByText("What went well")).toBeInTheDocument();
    expect(client.setPrediction).not.toHaveBeenCalled();
    expect(screen.queryByRole("list", { name: "Your guesses" })).toBeNull();
  });

  it("offers guessing first once, after ten transcribed takes", async () => {
    const user = userEvent.setup();
    const facts = factsBuilder("2026-10-16").session();
    for (let i = 0; i < 10; i += 1) facts.take({ transcribed: true });
    const setPreferences = vi.fn(async (p: Preferences) => p);
    const client: IpcClient = {
      ...createMockClient(), recordingMode: "native", listTakeCoaching: async () => [], getAttemptTranscript: async () => transcript,
      getPracticeFacts: async () => facts.build(), setPreferences,
      getAudioMeasures: async (attemptId) => ({ attemptId, method: "nuclei-v1", syllables: null, spanMs: null, phonationMs: null, rateSps: null, articulationSps: null, unavailableReason: "Needs at least 5 seconds of speech." }),
    };
    renderWithApp(<TakeSummary attemptId="take-1" durationMs={60_000} />, { client });
    const tip = await screen.findByRole("note");
    expect(tip).toHaveTextContent("Try guessing first");
    await user.click(within(tip).getByRole("button", { name: "Turn it on" }));
    await waitFor(() => expect(setPreferences).toHaveBeenCalledWith(expect.objectContaining({ predictFirst: true, predictTipSeen: true })));
  });
});
