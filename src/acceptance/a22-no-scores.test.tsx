/**
 * A-22: no filler, prosody or imitation value is shown as a score, a grade or a
 * mood label. Every screen that shows these values is rendered with realistic
 * data, and the source of each is checked too. Sentences that say there is no
 * score ("never a score", "no mood detection") are the allowed exception.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import type { ReactNode } from "react";
import { expect, it } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { AttemptTranscript, CoachingRun, IntonationContour, ReferenceClip, TranscriptMeasures } from "@/lib/ipc/schemas";
import { IntonationTrack } from "@/features/review/IntonationTrack";
import { summarizeTake, TakeSummary } from "@/features/review/TakeSummary";
import { describeEnding, ImitationOverlay } from "@/features/practice/ImitationOverlay";
import { ProgressPage } from "@/features/progress/ProgressPage";
import { offending } from "@/test/no-scores";


const contour = (f0: (number | null)[], median: number | null): IntonationContour => ({
  algorithm: "yin-v1", source: "Estimated", hopMs: 10, sampleRate: 16_000, f0Hz: f0, rmsDb: f0.map((v) => (v ? -20 : null)),
  medianF0Hz: median, rangeSemitones: median ? 5.8 : null, loudnessRangeDb: median ? 6.2 : null, unavailableReason: null,
});
const rising = [...Array(20).fill(null), ...Array(100).fill(120), ...Array.from({ length: 30 }, (_, i) => 120 + i)];
const falling = [...Array(20).fill(null), ...Array(100).fill(200), ...Array.from({ length: 30 }, (_, i) => 200 - (50 * i) / 29)];

const filler = (word: string, decision: "confirmed" | "dismissed" | null = null) => ({ segment: 0, word, segmentStartMs: 0, wordStartMs: null, wordEndMs: null, decision });
function transcript(measures: Partial<TranscriptMeasures>): AttemptTranscript {
  return {
    attemptId: "take-1", correction: null, job: null,
    revision: {
      id: "rev-1", source: "local", provider: null, modelId: "base", backend: "cpu", prompt: null, language: "en", text: "Um, so, uh, indexes help.",
      workerElapsedMs: 1, createdAt: "2026-10-10T08:00:00Z", segments: [],
      measures: { definitionVersion: 1, source: "Estimated", wordCount: 40, speechSpanMs: 21_000, paceWpm: 114, paceUnavailableReason: null, pauseThresholdMs: 700,
        pauses: [{ afterSegment: 0, startMs: 4_000, durationMs: 900 }], pausesUnavailableReason: null, fillers: [], repeatedWords: ["the"], untimedSegments: 0, voice: null, ...measures },
    },
  };
}
const coaching: CoachingRun = {
  id: "run-1", attemptId: "take-1", revisionId: "rev-1", provider: "OpenAI", model: "gpt-6-luna", payloadSha256: "a".repeat(64), sentText: "…", transcriptText: "…", deliveryImpressions: true,
  feedback: { summary: "Your example made the point concrete.", oneImprovement: "Say the main point first.", nextAttempt: "Open with the answer.", corrections: [], phrases: [],
    deliveryNotes: [{ part: 1, note: "The ending rises +2.4 st, so it may sound like a question." }] },
  inputTokens: 1, outputTokens: 1, estimatedCostMicroUsd: 1, costUnavailableReason: null, createdAt: "2026-10-10T08:05:00Z",
};

function shell(client: IpcClient, ui: ReactNode, path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IpcContext.Provider value={client}>{ui}</IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

it("filler review summaries name candidates and pauses, never a score", () => {
  const variants: Partial<TranscriptMeasures>[] = [
    { fillers: [] },
    { fillers: [filler("um"), filler("uh")] },
    { fillers: [filler("um"), filler("uh", "confirmed"), filler("um"), filler("er")], speechSpanMs: null },
    { fillers: [filler("um", "dismissed")], paceWpm: null, paceUnavailableReason: "Needs at least 15 seconds of speech." },
    { wordCount: 9 },
    { wordCount: 0 },
  ];
  for (const measures of variants) {
    const summary = summarizeTake(transcript(measures));
    const text = JSON.stringify(summary);
    expect(offending(text), text).toEqual([]);
  }
  for (const change of [-6, -0.3, 0, 0.4, 2, 9, null]) expect(offending(describeEnding(change))).toEqual([]);
});

it("take summaries, intonation and imitation views show measures and AI impressions without scores or mood labels", async () => {
  const user = userEvent.setup();
  const client: IpcClient = {
    ...createMockClient(),
    recordingMode: "native",
    getAttemptTranscript: async () => transcript({ fillers: [filler("um"), filler("uh"), filler("um")] }),
    listTakeCoaching: async () => [coaching],
    getTakeProsody: async () => contour(rising, 120),
    getClipProsody: async () => contour(falling, 200),
  };
  const summary = shell(client, <TakeSummary attemptId="take-1" />);
  await screen.findByRole("group", { name: "Take summary" });
  expect(offending(document.body.textContent ?? "")).toEqual([]);
  summary.unmount();

  const track = shell(client, <IntonationTrack attemptId="take-1" />);
  await user.click(screen.getByRole("button", { name: "Show intonation" }));
  await screen.findByText(/median 120 Hz/);
  const endings = screen.queryByText(/Phrase endings/);
  if (endings) await user.click(endings);
  expect(offending(document.body.textContent ?? "")).toEqual([]);
  track.unmount();

  const clip: ReferenceClip = { id: "voa-1", origin: "bundled", title: "Jack Frost", source: "VOA", transcript: null, durationMs: 15_000, sha256: "a".repeat(64), createdAtMs: 1 };
  shell(client, <ImitationOverlay clip={clip} takeAssetId="take-1" />);
  const figure = await screen.findByRole("img");
  expect(offending(`${document.body.textContent} ${figure.getAttribute("aria-label")}`)).toEqual([]);
});

it("Progress shows evidence in every view without combining it into a score", async () => {
  const user = userEvent.setup();
  shell(createMockClient(), <ProgressPage />, "/progress");
  for (const tab of ["Rehearsed practice", "Unfamiliar tasks", "Real conversations"]) {
    await user.click(await screen.findByRole("tab", { name: tab }));
    await screen.findByRole("tabpanel");
    expect(offending(document.body.textContent ?? ""), tab).toEqual([]);
  }
});

/** The screens that show filler, prosody and imitation values. */
const screens = import.meta.glob(
  ["/src/features/review/*.{ts,tsx}", "/src/features/progress/*.{ts,tsx}", "/src/features/today/*.{ts,tsx}", "/src/features/practice/ImitationOverlay.tsx", "/src/features/practice/CompletionPage.tsx", "!/src/**/*.test.{ts,tsx}"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

it("the screens that show these values carry no score, grade or mood wording in their source", () => {
  expect(Object.keys(screens).length).toBeGreaterThan(15);
  for (const [file, text] of Object.entries(screens)) {
    // Code comments may discuss what is avoided; only what the user can read counts.
    const visible = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const strings = visible.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`|>[^<>{}]+</g) ?? [];
    expect(strings.flatMap((s) => offending(s, false)), file).toEqual([]);
  }
});
