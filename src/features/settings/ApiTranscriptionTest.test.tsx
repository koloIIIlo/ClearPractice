import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { AudioPreview } from "@/lib/ipc/schemas";
import { ApiTranscriptionTest } from "./ApiTranscriptionTest";

const preview: AudioPreview = {
  requestId: "api-deepgram-1", provider: "deepgram", providerLabel: "Deepgram", model: "nova-3", recipient: "api.deepgram.com",
  attemptId: "take-1", durationMs: 61_000, bytes: 1_952_044, audioSha256: "a".repeat(64),
  settings: { model: "nova-3", filler_words: true, mip_opt_out: true }, estimatedCostMicroUsd: 8_600,
  priceSource: "https://deepgram.com/pricing", priceDate: "2026-10-08", dataHandling: "Sent with mip_opt_out=true.", payloadSha256: "b".repeat(64),
};

function setup(overrides: Partial<IpcClient>) {
  const client: IpcClient = {
    ...createMockClient(),
    recordingMode: "native",
    listRecordings: async () => [{ attemptId: "take-1", assetId: "take-1", title: "Explaining indexes", createdAtMs: 0, durationMs: 61_000, sampleRate: 48_000, channels: 1, sourceChannels: 2, sourceFormat: "F32", bytes: 10, sha256: "c".repeat(64), recovered: false }],
    previewApiTranscription: vi.fn(async () => preview),
    cancelApiTranscriptionPreview: vi.fn(async () => {}),
    requestApiTranscription: vi.fn(async () => ({
      requestId: "api-deepgram-1", provider: "deepgram" as const, model: "nova-3", text: "Well, uh, indexes help.", wordCount: 3, fillerCount: 1,
      wordTimings: true, wordTimingsUnavailableReason: null, providerRequestId: "dg-1", audioDurationMs: 61_000, estimatedCostMicroUsd: 8_600,
    })),
    ...overrides,
  };
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><ApiTranscriptionTest /></IpcContext.Provider></QueryClientProvider>);
  return client;
}

it("previews exactly what is sent and needs a stored key and an explicit Send", async () => {
  const user = userEvent.setup();
  const client = setup({});
  await user.click(await screen.findByRole("button", { name: "Preview request" }));
  expect(client.previewApiTranscription).toHaveBeenCalledWith("take-1", "deepgram");
  const box = screen.getByLabelText("API transcription request preview");
  expect(box).toHaveTextContent("Recipient: Deepgram · api.deepgram.com · nova-3");
  expect(box).toHaveTextContent("1:01");
  expect(box).toHaveTextContent("price checked 2026-10-08");
  expect(within(box).getByRole("button", { name: "Send take · may be billed" })).toBeDisabled();
  expect(box).toHaveTextContent("Store your Deepgram Nova-3 key above before sending.");
  expect(client.requestApiTranscription).not.toHaveBeenCalled();
});

it("sends once after approval and saves the result as a separate transcript without replacing the local one", async () => {
  const user = userEvent.setup();
  const client = setup({ getTranscriptionApiKeys: async () => [{ provider: "deepgram", present: true }, { provider: "assemblyai", present: false }] });
  await user.click(await screen.findByRole("button", { name: "Preview request" }));
  await user.click(await screen.findByRole("button", { name: "Send take · may be billed" }));
  expect(client.requestApiTranscription).toHaveBeenCalledWith("api-deepgram-1", "b".repeat(64));
  expect(await screen.findByText("Well, uh, indexes help.")).toBeInTheDocument();
  expect(screen.getByText(/1 filler candidates · word timings returned \(Estimated\)/)).toBeInTheDocument();
  expect(screen.getByText(/Saved with this take as a separate transcript.*local transcript and corrections are unchanged/)).toBeInTheDocument();
  expect(screen.queryByLabelText("API transcription request preview")).not.toBeInTheDocument();
});
