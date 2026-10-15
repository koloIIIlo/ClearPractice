import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { RecordingStatus, TranscriptionEvent } from "@/lib/ipc/schemas";
import { TranscriptionQueueProvider } from "@/features/transcription/queue";
import { useAutoTranscribe } from "./auto-transcribe";

function Takes({ ids }: { ids: string[] }) {
  useAutoTranscribe(ids, "s-1", { enabled: true });
  return null;
}

it("transcribes new takes one at a time with local Whisper, also when Cloud is the default, and waits while recording", async () => {
  const done = new Set<string>();
  let finish: (event: TranscriptionEvent) => void = () => {};
  let recording: (status: RecordingStatus) => void = () => {};
  const client = {
    ...createMockClient(),
    recordingMode: "native",
    getTranscriptionPreference: async () => ({ mode: "api", provider: "deepgram" }),
    getTranscriptionSetup: async () => ({ configured: true }),
    getAttemptTranscript: vi.fn(async (id: string) => ({ revision: done.has(id) ? { id: `r-${id}` } : null, job: null })),
    transcribeAttempt: vi.fn(async (id: string) => `job-${id}`),
    onTranscriptionEvent: vi.fn(async (listener: (event: TranscriptionEvent) => void) => { finish = listener; return () => {}; }),
    onRecordingEvent: vi.fn(async (listener: (status: RecordingStatus) => void) => { recording = listener; return () => {}; }),
  } as unknown as IpcClient;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (ids: string[]) => (
    <QueryClientProvider client={qc}><IpcContext.Provider value={client}><TranscriptionQueueProvider><Takes ids={ids} /></TranscriptionQueueProvider></IpcContext.Provider></QueryClientProvider>
  );
  const view = render(ui(["a1"]));
  await waitFor(() => expect(client.transcribeAttempt).toHaveBeenCalledWith("a1"));

  // A new take starts recording while a1 is transcribing: the queue holds a2 until the take is saved.
  act(() => recording({ phase: "recording" } as RecordingStatus));
  view.rerender(ui(["a1", "a2"]));
  done.add("a1");
  await act(async () => finish({ jobId: "job-a1", attemptId: "a1", phase: "finished", percent: null }));
  await new Promise((r) => setTimeout(r, 30));
  expect(client.transcribeAttempt).toHaveBeenCalledTimes(1);

  act(() => recording({ phase: "saved" } as RecordingStatus));
  await waitFor(() => expect(client.transcribeAttempt).toHaveBeenLastCalledWith("a2"));
  expect(client.transcribeAttempt).toHaveBeenCalledTimes(2);
});
