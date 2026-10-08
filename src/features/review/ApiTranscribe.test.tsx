import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { AudioPreview, AudioResult } from "@/lib/ipc/schemas";
import { MemoryRouter } from "react-router";
import { CloudTranscribe } from "./ApiTranscribe";

const preview: AudioPreview = {
  requestId: "api-assemblyai-1", provider: "assemblyai", providerLabel: "AssemblyAI", model: "universal-3-5-pro", recipient: "api.assemblyai.com",
  attemptId: "take-1", durationMs: 30_000, bytes: 960_044, audioSha256: "a".repeat(64), settings: { disfluencies: true }, estimatedCostMicroUsd: 3_500,
  priceSource: "https://www.assemblyai.com/pricing", priceDate: "2026-10-08", dataHandling: "Deleted after processing.", payloadSha256: "b".repeat(64),
  previousRunAt: "2026-10-07T09:00:00Z",
};

function setup(keys: { provider: "deepgram" | "assemblyai"; present: boolean }[]) {
  const qc = new QueryClient();
  const client: IpcClient = {
    ...createMockClient(),
    recordingMode: "native",
    getTranscriptionApiKeys: async () => keys,
    previewApiTranscription: vi.fn(async () => preview),
    cancelApiTranscriptionPreview: vi.fn(async () => {}),
    getApiPreviewAudioUrl: vi.fn(async () => "http://asset.localhost/prepared.wav"),
    requestApiTranscription: vi.fn(async () => ({
      requestId: "api-assemblyai-1", provider: "assemblyai" as const, model: "universal-3-5-pro", text: "Um, so.", wordCount: 2, fillerCount: 1,
      wordTimings: true, wordTimingsUnavailableReason: null, providerRequestId: "aai-1", audioDurationMs: 30_000, estimatedCostMicroUsd: 3_500,
    })),
  };
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const view = render(<MemoryRouter><QueryClientProvider client={qc}><IpcContext.Provider value={client}><CloudTranscribe attemptId="take-1" defaultProvider="deepgram" /></IpcContext.Provider></QueryClientProvider></MemoryRouter>);
  return { client, invalidate, view };
}

it("points to Settings when no provider key is stored and offers nothing to send", async () => {
  setup([{ provider: "deepgram", present: false }, { provider: "assemblyai", present: false }]);
  expect(await screen.findByRole("link", { name: /Store one in Settings/ })).toHaveAttribute("href", "/settings/transcription");
  expect(screen.queryByRole("button", { name: "Preview request" })).not.toBeInTheDocument();
});

it("falls back to the stored provider, labels a repeat as a paid retranscription and refreshes the take", async () => {
  const user = userEvent.setup();
  const { client, invalidate } = setup([{ provider: "deepgram", present: false }, { provider: "assemblyai", present: true }]);
  await user.click(await screen.findByRole("button", { name: "Preview request" }));
  expect(client.requestApiTranscription).not.toHaveBeenCalled(); // a preview sends nothing
  expect(client.previewApiTranscription).toHaveBeenCalledWith("take-1", "assemblyai");
  expect(screen.getByText(/already transcribed with these settings.*Sending again is a new paid run/)).toBeInTheDocument();
  expect(await screen.findByLabelText("Listen to exactly the audio that Send uploads")).toHaveAttribute("src", "http://asset.localhost/prepared.wav");
  await user.click(screen.getByRole("button", { name: "Retranscribe · may be billed" }));
  expect(client.requestApiTranscription).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("Um, so.")).toBeInTheDocument();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["attempt-transcript", "take-1"] });
});

it("lets the user stop waiting for a sent request and shows why the charge is uncertain", async () => {
  const user = userEvent.setup();
  const { client } = setup([{ provider: "assemblyai", present: true }]);
  let fail: (e: Error) => void = () => {};
  client.requestApiTranscription = vi.fn(() => new Promise<AudioResult>((_, reject) => { fail = reject; }));
  client.cancelApiTranscription = vi.fn(async () => fail(new Error("Stopped waiting. The provider may still finish and bill this request, so its charge is uncertain; nothing is retried.")));
  await user.click(await screen.findByRole("button", { name: "Preview request" }));
  await user.click(await screen.findByRole("button", { name: "Retranscribe · may be billed" }));
  await user.click(await screen.findByRole("button", { name: "Stop waiting" }));
  expect(client.cancelApiTranscription).toHaveBeenCalledWith("api-assemblyai-1");
  expect(await screen.findByRole("alert")).toHaveTextContent(/charge is uncertain.*Prepare a new preview/);
  expect(screen.queryByRole("button", { name: "Stop waiting" })).not.toBeInTheDocument();
});
