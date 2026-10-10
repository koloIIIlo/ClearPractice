import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { AttemptTranscript, CoachingRun, TranscriptMeasures } from "@/lib/ipc/schemas";
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

function setup(overrides: Partial<IpcClient>) {
  const client: IpcClient = { ...createMockClient(), recordingMode: "native", listTakeCoaching: async () => [], ...overrides };
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IpcContext.Provider value={client}>
          <TakeSummary attemptId="take-1" reviewHref="/sessions/s-1/attempt/1" />
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
    expect(screen.getAllByText("Estimated")).toHaveLength(2);
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
