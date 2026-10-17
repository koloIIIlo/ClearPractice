/**
 * A-35: your self-reports (the quick self-check, 8.3) carry the Your note label
 * and never sit inside a measure's row. Every answer control and every "Your
 * note" label in the take summary belongs to the self-check section, and that
 * section is not part of the Flow or Words measures. Predictions (11.5) are
 * self-reports too: each guess is Your note, each value from the take is
 * Estimated, and neither sits inside a measure fold.
 */
import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { IpcClient } from "@/lib/ipc";
import { DEFAULT_PREFERENCES, type AttemptTranscript } from "@/lib/ipc/schemas";
import { TakeSummary } from "@/features/review/TakeSummary";
import { renderWithApp } from "@/test/render";

const transcript: AttemptTranscript = {
  attemptId: "take-1", correction: null, job: null,
  revision: {
    id: "rev-1", source: "local", provider: null, modelId: "base", backend: "cpu", prompt: null, language: "en", text: "…", workerElapsedMs: 1, createdAt: "2026-10-16T08:00:00Z",
    segments: [{ text: "Um, so I plan first, then I write it down, so yeah.", startMs: 0, endMs: 9_000, timingSource: "Estimated", timingUnavailableReason: null }],
    measures: {
      definitionVersion: 2, source: "Estimated", wordCount: 64, speechSpanMs: 95_000, paceWpm: 120, paceUnavailableReason: null, pauseThresholdMs: 700,
      pauses: [{ afterSegment: 0, startMs: 4_000, durationMs: 900 }], pausesUnavailableReason: null, fillers: [], repeatedWords: [], untimedSegments: 0, voice: null,
      pauseKinds: ["boundary"], runs: { meanWords: 8, longestWords: 16, longestFromSegment: 0, longestToSegment: 0, count: 4 }, runsUnavailableReason: null,
      watchWords: [], hedges: [], wordsUnavailableReason: null, differentPer50: 38, vocabularyUnavailableReason: null,
      opener: { text: "Um, so I plan first.", segment: 0, hint: "starts_with_hesitation" }, ending: { text: "…so yeah.", segment: 0, hint: "trails_off" },
    },
  },
};

it("A-35 self-check answers carry Your note and never sit inside a measure's row", async () => {
  const client: IpcClient = {
    ...createMockClient(), recordingMode: "native", listTakeCoaching: async () => [], getAttemptTranscript: async () => transcript,
    listSelfChecks: async () => [{ attemptId: "take-1", checkId: "point_first", value: true, createdAt: "2026-10-16T08:01:00Z" }],
    getAudioMeasures: async (attemptId) => ({ attemptId, method: "nuclei-v1", syllables: null, spanMs: null, phonationMs: null, rateSps: null, articulationSps: null, unavailableReason: "Needs at least 5 seconds of speech." }),
  };
  renderWithApp(<TakeSummary attemptId="take-1" durationMs={95_000} />, { client });
  const section = await screen.findByRole("region", { name: "Quick self-check" });
  // Three questions on a take of 90 s or more, each answered inside the section.
  const questions = screen.getAllByRole("radiogroup");
  expect(questions).toHaveLength(3);
  for (const q of questions) expect(q.closest("[data-self-check]")).toBe(section);
  for (const label of screen.getAllByText("Your note")) expect(label.closest("[data-self-check]")).toBe(section);
  // The section is not inside a measure fold, and no measure row holds an answer.
  expect(section.closest("details")).toBeNull();
  for (const fold of document.querySelectorAll("details")) {
    expect(fold.querySelector("[role=radiogroup]")).toBeNull();
    expect(fold).not.toHaveTextContent("Your note");
  }
});

it("A-35 predictions: the guess is Your note, the take's value Estimated, and neither judges the audio", async () => {
  const client: IpcClient = {
    ...createMockClient(), recordingMode: "native", listTakeCoaching: async () => [], getAttemptTranscript: async () => transcript,
    getPreferences: async () => ({ ...DEFAULT_PREFERENCES, predictFirst: true }),
    listPredictions: async () => [
      { attemptId: "take-1", kind: "hesitations", predicted: "2-4", createdAt: "2026-10-16T08:01:00Z" },
      { attemptId: "take-1", kind: "pace", predicted: "slower", createdAt: "2026-10-16T08:01:00Z" },
    ],
    getAudioMeasures: async (attemptId) => ({ attemptId, method: "nuclei-v1", syllables: null, spanMs: null, phonationMs: null, rateSps: null, articulationSps: null, unavailableReason: "Needs at least 5 seconds of speech." }),
  };
  renderWithApp(<TakeSummary attemptId="take-1" durationMs={95_000} />, { client });
  const guesses = await screen.findByRole("list", { name: "Your guesses" });
  for (const row of guesses.querySelectorAll("li")) {
    const labels = [...row.querySelectorAll("[title]")].map((l) => l.textContent);
    expect(labels).toEqual(["Your note", "Estimated"]);
  }
  expect(guesses.closest("details")).toBeNull();
  // A guess is compared with the value, never turned into a verdict on your voice.
  expect(guesses).not.toHaveTextContent(/wrong|correct|score|%/i);
});
