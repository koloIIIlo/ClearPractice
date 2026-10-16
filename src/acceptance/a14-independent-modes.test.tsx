/**
 * A-14: Transcription (Local / Cloud API / Off) and Coaching (API / Local LLM /
 * Off) switch independently. Switching never sends, uploads or downloads
 * anything; automatic transcription never falls back to the cloud or starts a
 * download, and Off means nothing is transcribed.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { DEFAULT_PREFERENCES, type Preferences, type RecordingStatus, type TranscriptionPreference } from "@/lib/ipc/schemas";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { TranscriptionQueueProvider } from "@/features/transcription/queue";
import { useAutoTranscribe } from "@/features/practice/auto-transcribe";

/** Every way something could leave the computer or be fetched from the internet. */
function outbound() {
  return {
    previewApiTranscription: vi.fn(async () => { throw new Error("must not preview"); }),
    requestApiTranscription: vi.fn(async () => { throw new Error("must not upload"); }),
    requestSplitTranscription: vi.fn(async () => { throw new Error("must not upload"); }),
    requestTakeCoaching: vi.fn(async () => { throw new Error("must not send"); }),
    requestFollowUp: vi.fn(async () => { throw new Error("must not send"); }),
    requestCoaching: vi.fn(async () => { throw new Error("must not send"); }),
    requestPhraseSuggestions: vi.fn(async () => { throw new Error("must not send"); }),
    downloadWhisper: vi.fn(async () => { throw new Error("must not download"); }),
    downloadLinkTool: vi.fn(async () => { throw new Error("must not download"); }),
  };
}

function expectNothingLeft(client: ReturnType<typeof outbound>) {
  for (const [name, fn] of Object.entries(client)) expect(fn, name).not.toHaveBeenCalled();
}

it("switches coaching and transcription independently, and switching sends, uploads and downloads nothing", async () => {
  const user = userEvent.setup();
  let prefs: Preferences = { ...DEFAULT_PREFERENCES, coachingMode: "api" };
  let transcription: TranscriptionPreference = { mode: "local", provider: "deepgram" };
  const sent = outbound();
  const client: IpcClient = {
    ...createMockClient(),
    recordingMode: "native",
    ...sent,
    getPreferences: async () => prefs,
    setPreferences: vi.fn(async (next: Preferences) => (prefs = next)),
    getTranscriptionPreference: async () => transcription,
    setTranscriptionPreference: vi.fn(async (next: TranscriptionPreference) => (transcription = next)),
    getTranscriptionApiKeys: async () => [{ provider: "deepgram" as const, present: true }, { provider: "assemblyai" as const, present: true }],
    getTranscriptionSetup: async () => ({ configured: false, modelId: null, backend: null, prompt: null, unavailableReason: "Not set up." }),
  } as IpcClient;
  render(
    <MemoryRouter initialEntries={["/settings/coaching"]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IpcContext.Provider value={client}>
          <Routes><Route path="/settings/:section?" element={<SettingsPage />} /></Routes>
        </IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );

  // Coaching: API → Local LLM → Off → API. Transcription stays as it was.
  for (const [label, mode] of [["Local LLM", "local"], ["Off", "off"], ["API", "api"]] as const) {
    await user.click(await screen.findByRole("radio", { name: new RegExp(`^${label}`) }));
    await waitFor(() => expect(client.setPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ coachingMode: mode })));
  }
  expect(client.setTranscriptionPreference).not.toHaveBeenCalled();
  expect(transcription).toEqual({ mode: "local", provider: "deepgram" });

  // Transcription: Local → Cloud API (AssemblyAI) → back. Coaching stays as it was.
  const coachingWrites = vi.mocked(client.setPreferences).mock.calls.length;
  await user.click(screen.getByRole("link", { name: "Transcription" }));
  await user.click(await screen.findByRole("radio", { name: /Cloud API/ }));
  await waitFor(() => expect(client.setTranscriptionPreference).toHaveBeenLastCalledWith({ mode: "api", provider: "deepgram" }));
  await user.click(await screen.findByRole("radio", { name: /AssemblyAI/ }));
  await waitFor(() => expect(client.setTranscriptionPreference).toHaveBeenLastCalledWith({ mode: "api", provider: "assemblyai" }));
  await user.click(screen.getByRole("radio", { name: /On this computer/ }));
  await waitFor(() => expect(client.setTranscriptionPreference).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "local" })));
  expect(vi.mocked(client.setPreferences).mock.calls.length).toBe(coachingWrites);
  expect(prefs.coachingMode).toBe("api");

  // Local Whisper isn't set up: the page offers a download, but nothing starts by itself.
  await new Promise((r) => setTimeout(r, 30));
  expectNothingLeft(sent);
}, 20_000);

function Takes({ ids }: { ids: string[] }) {
  useAutoTranscribe(ids, "s-1", { enabled: true });
  return null;
}

it("automatic transcription runs only on this computer: Off transcribes nothing, and a missing local setup never falls back to the cloud or downloads", async () => {
  const cases: { mode: TranscriptionPreference["mode"]; configured: boolean; local: boolean }[] = [
    { mode: "off", configured: true, local: false },
    { mode: "api", configured: false, local: false },
    { mode: "local", configured: false, local: false },
    { mode: "api", configured: true, local: true },
    { mode: "local", configured: true, local: true },
  ];
  for (const { mode, configured, local } of cases) {
    const sent = outbound();
    const client = {
      ...createMockClient(),
      recordingMode: "native",
      ...sent,
      getTranscriptionPreference: async () => ({ mode, provider: "assemblyai" }),
      getTranscriptionSetup: async () => ({ configured, modelId: configured ? "base" : null, backend: null, prompt: null, unavailableReason: configured ? null : "Not set up." }),
      getAttemptTranscript: vi.fn(async () => ({ attemptId: "a1", revision: null, correction: null, job: null })),
      transcribeAttempt: vi.fn(async (id: string) => `job-${id}`),
      onTranscriptionEvent: vi.fn(async () => () => {}),
      onRecordingEvent: vi.fn(async (listener: (s: RecordingStatus) => void) => { void listener; return () => {}; }),
    } as unknown as IpcClient;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={qc}><IpcContext.Provider value={client}><TranscriptionQueueProvider><Takes ids={["a1"]} /></TranscriptionQueueProvider></IpcContext.Provider></QueryClientProvider>);
    if (local) {
      await waitFor(() => expect(client.transcribeAttempt).toHaveBeenCalledWith("a1"));
    } else {
      await waitFor(() => expect(qc.getQueryData(["transcription-setup"])).toBeDefined());
      await new Promise((r) => setTimeout(r, 40));
      expect(client.transcribeAttempt, `${mode}/${configured}`).not.toHaveBeenCalled();
    }
    expectNothingLeft(sent);
    view.unmount();
  }
});
