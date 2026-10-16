/**
 * A-23: selecting the cloud, storing a key, opening a take, previewing,
 * switching screens, the app regaining the network or focus, and a restart
 * never upload audio. Only Send on a preview does, once. (The native side
 * checks that changed audio, hints, recipient, model or price void an
 * approval: api::audio::tests::a23_any_change_to_what_was_approved_rejects_the_approval.)
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { AudioPreview } from "@/lib/ipc/schemas";
import { CloudTranscribe } from "@/features/review/ApiTranscribe";
import { ApiTranscriptionTest } from "@/features/settings/ApiTranscriptionTest";

const preview: AudioPreview = {
  requestId: "api-deepgram-1", provider: "deepgram", providerLabel: "Deepgram", model: "nova-3", recipient: "api.deepgram.com", attemptId: "take-1",
  durationMs: 30_000, bytes: 960_044, audioSha256: "a".repeat(64), settings: { filler_words: true }, estimatedCostMicroUsd: 4_300,
  priceSource: "https://deepgram.com/pricing", priceDate: "2026-10-08", dataHandling: "Sent with mip_opt_out=true.", payloadSha256: "b".repeat(64), previousRunAt: null,
};

function client(): IpcClient {
  return {
    ...createMockClient(),
    recordingMode: "native",
    getTranscriptionPreference: async () => ({ mode: "api", provider: "deepgram" }),
    getTranscriptionApiKeys: async () => [{ provider: "deepgram" as const, present: true }, { provider: "assemblyai" as const, present: true }],
    previewApiTranscription: vi.fn(async () => preview),
    getApiPreviewAudioUrl: vi.fn(async () => "http://asset.localhost/prepared.wav"),
    cancelApiTranscriptionPreview: vi.fn(async () => {}),
    requestApiTranscription: vi.fn(async () => { throw new Error("must not upload"); }),
    storeTranscriptionApiKey: vi.fn(async (provider) => ({ provider, present: true })),
  };
}

const take = (ipc: IpcClient) =>
  render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={ipc}><CloudTranscribe attemptId="take-1" defaultProvider="deepgram" /></IpcContext.Provider></QueryClientProvider></MemoryRouter>);

function lifeEvents() {
  window.dispatchEvent(new Event("online"));
  window.dispatchEvent(new Event("focus"));
  document.dispatchEvent(new Event("visibilitychange"));
}

it("a take with the cloud selected and keys stored uploads nothing until Send, also when previewed, refocused, reconnected or left", async () => {
  const user = userEvent.setup();
  const ipc = client();
  const first = take(ipc);
  await screen.findByRole("button", { name: "Preview request" });
  act(lifeEvents);
  expect(ipc.previewApiTranscription).not.toHaveBeenCalled(); // opening the take prepares nothing

  await user.click(screen.getByRole("button", { name: "Preview request" }));
  await screen.findByRole("group", { name: "API transcription request preview" });
  act(lifeEvents);
  await new Promise((r) => setTimeout(r, 20));
  expect(ipc.requestApiTranscription).not.toHaveBeenCalled();

  // Switching screens (the take view unmounts) discards the preview without sending it.
  first.unmount();
  expect(ipc.cancelApiTranscriptionPreview).toHaveBeenCalledWith("api-deepgram-1");
  expect(ipc.requestApiTranscription).not.toHaveBeenCalled();

  // Coming back, or a restart: no preview is restored; a new one needs a new click.
  take(ipc);
  await screen.findByRole("button", { name: "Preview request" });
  expect(screen.queryByRole("group", { name: "API transcription request preview" })).not.toBeInTheDocument();
  expect(ipc.previewApiTranscription).toHaveBeenCalledTimes(1);
  expect(ipc.requestApiTranscription).not.toHaveBeenCalled();
});

it("cancelling a preview and choosing another provider never send the old approval", async () => {
  const user = userEvent.setup();
  const ipc = client();
  take(ipc);
  await user.click(await screen.findByRole("button", { name: "Preview request" }));
  await user.click(await screen.findByRole("button", { name: "Cancel preview" }));
  expect(ipc.cancelApiTranscriptionPreview).toHaveBeenLastCalledWith("api-deepgram-1");
  await user.click(screen.getByRole("button", { name: "Preview request" }));
  await screen.findByRole("group", { name: "API transcription request preview" });
  await user.click(screen.getByRole("radio", { name: /AssemblyAI/ }));
  await waitFor(() => expect(screen.queryByRole("group", { name: "API transcription request preview" })).not.toBeInTheDocument());
  expect(ipc.cancelApiTranscriptionPreview).toHaveBeenCalledTimes(2);
  expect(ipc.requestApiTranscription).not.toHaveBeenCalled();
});

it("storing a key in Settings sends nothing and leaves no copy in the interface's storage (A-12)", async () => {
  const user = userEvent.setup();
  const ipc = client();
  ipc.getTranscriptionApiKeys = async () => [{ provider: "deepgram" as const, present: false }, { provider: "assemblyai" as const, present: false }];
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={ipc}><ApiTranscriptionTest /></IpcContext.Provider></QueryClientProvider>);
  const field = (await screen.findAllByLabelText(/ key · not stored/))[0];
  await user.type(field, "fake-test-key-123");
  await user.click(screen.getAllByRole("button", { name: "Save" })[0]);
  await waitFor(() => expect(ipc.storeTranscriptionApiKey).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
  expect(ipc.previewApiTranscription).not.toHaveBeenCalled();
  expect(ipc.requestApiTranscription).not.toHaveBeenCalled();
  // The key went to the native store only: the field is cleared and nothing in the WebView keeps it.
  expect(field).toHaveValue("");
  const kept = [localStorage, sessionStorage].map((store) => Object.keys(store).map((k) => `${k}=${store.getItem(k)}`).join(";")).join("|");
  expect(kept).not.toContain("fake-test-key-123");
  expect(document.body.innerHTML).not.toContain("fake-test-key-123");
});

/** The source of every interface file, without tests and the IPC layer. */
const sources = import.meta.glob(["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}", "!/src/**/*.d.ts", "!/src/lib/ipc/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** The text of every call to `hook(...)`, with nested parentheses. */
function hookBodies(code: string, hook: string): string[] {
  const bodies: string[] = [];
  for (let at = code.indexOf(`${hook}(`); at !== -1; at = code.indexOf(`${hook}(`, at + 1)) {
    let depth = 0;
    for (let i = at + hook.length; i < code.length; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")" && --depth === 0) {
        bodies.push(code.slice(at, i + 1));
        break;
      }
    }
  }
  return bodies;
}

it("no effect, query or timer in the interface sends an API request; only user actions do", () => {
  const files = Object.entries(sources);
  expect(files.length).toBeGreaterThan(50);
  const sends = /\bipc\.request[A-Z]\w*\(/;
  let callers = 0;
  for (const [file, code] of files) {
    if (sends.test(code)) callers++;
    for (const hook of ["useEffect", "useLayoutEffect", "useQuery", "useQueries", "setTimeout", "setInterval", "queueMicrotask"]) {
      for (const body of hookBodies(code, hook)) expect(sends.test(body), `${file}: ${hook} sends a request`).toBe(false);
    }
  }
  expect(callers).toBeGreaterThanOrEqual(6); // the scan sees the send buttons' handlers
});
