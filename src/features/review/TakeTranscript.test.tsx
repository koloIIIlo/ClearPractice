import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { AttemptTranscript, TranscriptionEvent } from "@/lib/ipc/schemas";
import { TakeTranscript } from "./TakeTranscript";
import { createPlayerLink, type PlayerLink } from "./player-link";

function setup(overrides: Partial<IpcClient>, link?: PlayerLink) {
  const client: IpcClient = { ...createMockClient(), recordingMode: "native", ...overrides };
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IpcContext.Provider value={client}>
          <TakeTranscript attemptId="take-1" link={link} />
        </IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}

const configured = async () => ({ configured: true, modelId: "large-v3-turbo-q5_0", backend: "cuda" as const, prompt: "uh", unavailableReason: null });

it("points to Settings when local transcription is not set up", async () => {
  setup({});
  expect(await screen.findByText(/isn't set up yet/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Settings → Transcription/ })).toHaveAttribute("href", "/settings/transcription");
  expect(screen.getByRole("button", { name: "Transcribe" })).toBeDisabled();
});

it("shows progress, then the saved transcript with estimated timings and kept fillers", async () => {
  const user = userEvent.setup();
  let listener: (event: TranscriptionEvent) => void = () => {};
  let stored: AttemptTranscript = { attemptId: "take-1", revision: null, correction: null, job: null };
  const client = setup({
    getTranscriptionSetup: configured,
    getAttemptTranscript: vi.fn(async () => stored),
    transcribeAttempt: vi.fn(async () => "job-1"),
    onTranscriptionEvent: async (callback) => { listener = callback; return () => {}; },
  });
  await user.click(await screen.findByRole("button", { name: "Transcribe" }));
  expect(client.transcribeAttempt).toHaveBeenCalledWith("take-1");
  act(() => listener({ jobId: "job-1", attemptId: "take-1", phase: "running", percent: 42 }));
  expect(screen.getByRole("status")).toHaveTextContent("Transcribing · 42%");
  expect(screen.getByRole("button", { name: /Cancel/ })).toBeInTheDocument();

  // Events for other takes are ignored.
  act(() => listener({ jobId: "job-9", attemptId: "take-2", phase: "running", percent: 99 }));
  expect(screen.getByRole("status")).toHaveTextContent("42%");

  stored = {
    attemptId: "take-1",
    correction: null,
    job: { id: "job-1", state: "completed", errorMessage: null, createdAt: "2026-10-08T01:00:00.000Z", finishedAt: "2026-10-08T01:00:14.000Z" },
    revision: {
      id: "take-1--1", source: "local", provider: "whisper.cpp", modelId: "large-v3-turbo-q5_0", backend: "cuda", prompt: "uh",
      language: "en", text: "Well, uh, indexes speed up reads.", workerElapsedMs: 11_500, createdAt: "2026-10-08T01:00:14.000Z",
      segments: [{ text: " Well, uh, indexes speed up reads.", startMs: 12_000, endMs: 15_000, timingSource: "Estimated", timingUnavailableReason: null }],
      measures: {
        definitionVersion: 1, source: "Estimated", wordCount: 5, speechSpanMs: 3_000, paceWpm: null,
        paceUnavailableReason: "Needs at least 15 seconds of speech.", pauseThresholdMs: 700, pauses: [], pausesUnavailableReason: null,
        fillers: [{ segment: 0, word: "uh", segmentStartMs: 12_000, decision: null }], repeatedWords: [], untimedSegments: 0,
        voice: { method: "peak-energy-v1", source: "Estimated", speechStartMs: 0, speechEndMs: 3_000, pauses: [{ afterSegment: 0, startMs: 1_500, durationMs: 900 }], unavailableReason: null },
      },
    },
  };
  act(() => listener({ jobId: "job-1", attemptId: "take-1", phase: "finished", percent: null }));
  const filler = await screen.findByTitle("Filler candidate");
  expect(filler).toHaveTextContent("uh,");
  expect(filler.closest("li")).toHaveTextContent("Well, uh, indexes speed up reads.");
  expect(screen.getByText("Unavailable: Needs at least 15 seconds of speech.")).toBeInTheDocument();
  expect(screen.getByText("1 (uh)")).toBeInTheDocument();
  expect(screen.getByText("0.9 s at 0:02 · from the recording")).toBeInTheDocument();
  expect(screen.getByText("0:12")).toBeInTheDocument();
  expect(screen.getByText(/As transcribed · local large-v3-turbo-q5_0 \(CUDA\) · 12 s/)).toBeInTheDocument();
  expect(screen.getByText(/kept on\s+purpose/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Transcribe again" })).toBeEnabled();

  // Filler review: decisions are stored per candidate; a dismissed word is no longer highlighted.
  client.setFillerDecision = vi.fn(async (_revision: string, candidate: number, _word: string, decision: "confirmed" | "dismissed" | null) => {
    const r = stored.revision!;
    stored = { ...stored, revision: { ...r, measures: { ...r.measures, fillers: r.measures.fillers.map((f, i) => (i === candidate ? { ...f, decision } : f)) } } };
  });
  expect(screen.getByText(/0 confirmed, 0 dismissed, 1 to review/)).toBeInTheDocument();
  await user.click(screen.getByText(/Review filler candidates/));
  await user.click(screen.getByRole("button", { name: "Not a filler: “uh” 1" }));
  expect(client.setFillerDecision).toHaveBeenCalledWith("take-1--1", 0, "uh", "dismissed");
  expect(await screen.findByText(/0 confirmed, 1 dismissed, 0 to review/)).toBeInTheDocument();
  expect(screen.queryByTitle("Filler candidate")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Not a filler: “uh” 1" })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Not a filler: “uh” 1" }));
  expect(client.setFillerDecision).toHaveBeenLastCalledWith("take-1--1", 0, "uh", null);
  expect(await screen.findByTitle("Filler candidate")).toBeInTheDocument();

  // Corrections are saved as a child of the machine transcript, which stays visible.
  client.saveTranscriptCorrection = vi.fn(async () => {
    stored = { ...stored, correction: { id: "take-1--1--edit-2", parentId: "take-1--1", text: "Well, uh, indexes speed up reads a lot.", createdAt: "2026-10-08T01:01:00.000Z", fillerCount: 1, wordCount: 7 } };
    return "take-1--1--edit-2";
  });
  await user.click(screen.getByRole("button", { name: "Correct the transcript" }));
  const box = screen.getByLabelText("My corrections");
  expect(box).toHaveValue("Well, uh, indexes speed up reads.");
  // Unchanged text (spacing aside) is not a correction.
  expect(screen.getByRole("button", { name: "Save corrections" })).toBeDisabled();
  await user.type(box, "  ");
  expect(screen.getByRole("button", { name: "Save corrections" })).toBeDisabled();
  expect(screen.getByText("Change a word to save a correction.")).toBeInTheDocument();
  await user.clear(box);
  await user.type(box, "Well, uh, indexes speed up reads a lot.");
  await user.click(screen.getByRole("button", { name: "Save corrections" }));
  expect(client.saveTranscriptCorrection).toHaveBeenCalledWith("take-1", "take-1--1", "Well, uh, indexes speed up reads a lot.");
  expect(await screen.findByText("Well, uh, indexes speed up reads a lot.")).toBeInTheDocument();
  expect(screen.getByText(/7 words, 1 filler candidates/)).toBeInTheDocument();
  expect((await screen.findByTitle("Filler candidate")).closest("li")).toHaveTextContent("Well, uh, indexes speed up reads.");
});

it("explains a failed job and keeps the take available for another try", async () => {
  setup({
    getTranscriptionSetup: configured,
    getAttemptTranscript: async () => ({
      attemptId: "take-1",
      revision: null,
      correction: null,
      job: { id: "job-1", state: "interrupted", errorMessage: "ClearPractice closed before this transcription finished.", createdAt: "2026-10-08T01:00:00.000Z", finishedAt: null },
    }),
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Transcription was interrupted. ClearPractice closed before this transcription finished. The recording is unchanged.");
  expect(screen.getByRole("button", { name: "Transcribe" })).toBeEnabled();
});

it("starts in the default mode from Settings and lets each take switch between this computer and the cloud", async () => {
  const user = userEvent.setup();
  const client = setup({
    getTranscriptionSetup: configured,
    getTranscriptionPreference: async () => ({ mode: "api" as const, provider: "assemblyai" as const }),
    getTranscriptionApiKeys: async () => [{ provider: "deepgram" as const, present: false }, { provider: "assemblyai" as const, present: true }],
    transcribeAttempt: vi.fn(async () => "job-1"),
    previewApiTranscription: vi.fn(async () => { throw new Error("not in this test"); }),
  });
  // Cloud is the default: the take offers a preview, never an automatic send.
  await waitFor(() => expect(screen.getByRole("radio", { name: "Cloud API" })).toBeChecked());
  expect(await screen.findByRole("button", { name: "Preview request" })).toBeInTheDocument();
  expect(screen.getByText(/Sends this whole take to AssemblyAI/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Transcribe" })).not.toBeInTheDocument();
  expect(client.previewApiTranscription).not.toHaveBeenCalled();
  // Switch this take to local Whisper.
  await user.click(screen.getByRole("radio", { name: "This computer" }));
  await user.click(screen.getByRole("button", { name: "Transcribe" }));
  expect(client.transcribeAttempt).toHaveBeenCalledWith("take-1");
});

it("plays the take from a transcript line when it is clicked", async () => {
  const user = userEvent.setup();
  const link = createPlayerLink();
  const seek = vi.fn();
  link.attach(seek);
  const segment = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs, timingSource: "Estimated" as const, timingUnavailableReason: null });
  setup({
    getTranscriptionSetup: configured,
    getAttemptTranscript: async () => ({
      attemptId: "take-1", correction: null, job: null,
      revision: {
        id: "take-1--1", source: "local", provider: "whisper.cpp", modelId: "base", backend: "cpu", prompt: null, language: "en",
        text: "First line. Second line.", workerElapsedMs: 1_000, createdAt: "2026-10-08T01:00:14.000Z",
        segments: [segment(" First line.", 0, 2_000), segment(" Second line.", 2_000, 4_000)],
        measures: {
          definitionVersion: 1, source: "Estimated", wordCount: 4, speechSpanMs: 4_000, paceWpm: null, paceUnavailableReason: "Short.",
          pauseThresholdMs: 700, pauses: [], pausesUnavailableReason: null, fillers: [], repeatedWords: [], untimedSegments: 0,
          voice: { method: "peak-energy-v1", source: "Estimated", speechStartMs: 0, speechEndMs: 4_000, pauses: [], unavailableReason: null },
        },
      },
    }),
  }, link);
  const second = await screen.findByRole("button", { name: "Play from 0:02: Second line." });
  expect(screen.getByRole("button", { name: "Play from 0:00: First line." })).toHaveAttribute("aria-current", "true");
  await user.click(second);
  expect(seek).toHaveBeenCalledWith(2_000, true);
  act(() => link.publish(2_500));
  expect(second).toHaveAttribute("aria-current", "true");
});
