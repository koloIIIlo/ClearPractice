import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { AudioPreview } from "@/lib/ipc/schemas";
import { API_MODE_ENABLED, TakeApiTranscribe } from "./ApiTranscribe";

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
    requestApiTranscription: vi.fn(async () => ({
      requestId: "api-assemblyai-1", provider: "assemblyai" as const, model: "universal-3-5-pro", text: "Um, so.", wordCount: 2, fillerCount: 1,
      wordTimings: true, wordTimingsUnavailableReason: null, providerRequestId: "aai-1", audioDurationMs: 30_000, estimatedCostMicroUsd: 3_500,
    })),
  };
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const view = render(<QueryClientProvider client={qc}><IpcContext.Provider value={client}><TakeApiTranscribe attemptId="take-1" /></IpcContext.Provider></QueryClientProvider>);
  return { client, invalidate, view };
}

it("stays hidden until a provider key is stored", async () => {
  const { view } = setup([{ provider: "deepgram", present: false }, { provider: "assemblyai", present: false }]);
  await new Promise((r) => setTimeout(r, 0));
  expect(view.container).toBeEmptyDOMElement();
});

it("offers the stored provider, labels a repeat as a paid retranscription and refreshes the take", async () => {
  const user = userEvent.setup();
  const { client, invalidate } = setup([{ provider: "deepgram", present: false }, { provider: "assemblyai", present: true }]);
  await user.click(await screen.findByRole("button", { name: "Transcribe via API…" }));
  expect(client.previewApiTranscription).not.toHaveBeenCalled(); // opening sends nothing
  await user.click(screen.getByRole("button", { name: "Preview request" }));
  expect(client.previewApiTranscription).toHaveBeenCalledWith("take-1", "assemblyai");
  expect(screen.getByText(/already transcribed with these settings.*Sending again is a new paid run/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retranscribe · may be billed" }));
  expect(client.requestApiTranscription).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("Um, so.")).toBeInTheDocument();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["attempt-transcript", "take-1"] });
});

it("keeps API mode off on takes until the enablement gate passes", () => {
  // Flip only together with ticking "API transcription enablement gate" in DEVELOPMENT_PLAN.md.
  expect(API_MODE_ENABLED).toBe(false);
});
