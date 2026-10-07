import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { CoachingPreview } from "@/lib/ipc/schemas";
import { CoachingSpike } from "./CoachingSpike";

it("requires a separate Send action and invalidates the preview when its text changes", async () => {
  const client = { ...createMockClient(), recordingMode: "native" as const,
    getApiKeyStatus: async () => ({provider: "OpenAI" as const, present: true}),
    previewCoachingRequest: vi.fn(async (selectedText: string): Promise<CoachingPreview> => ({
      version: 1, requestId: "test-preview", payloadSha256: "a".repeat(64), recipient: "https://api.openai.com/v1/responses",
      model: "test-model", selectedText, prompt: "Explain an idea", focus: "Structure", instructions: "Keep intended meaning",
      maximumOutputTokens: 1024, estimatedMaximumCostMicroUsd: 4000, priceDate: "2026-10-04",
      priceSource: "https://developers.openai.com/api/docs/pricing", inputUsdPerMillionTokens: "0.10", outputUsdPerMillionTokens: "0.50",
      costExplanation: "Estimated upper reservation", expiresAtMs: Date.now() + 300000,
    })), cancelCoachingPreview: vi.fn(async () => {}),
    requestCoaching: vi.fn(async () => { throw new Error("provider failure"); }),
  };
  const user = userEvent.setup();
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><CoachingSpike /></IpcContext.Provider></QueryClientProvider>);
  expect(client.requestCoaching).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", {name: "Preview feedback test"}));
  await screen.findByLabelText("Feedback request preview");
  expect(client.requestCoaching).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Text to review"), " Edit");
  expect(screen.queryByRole("button", {name: /Send sample text/})).not.toBeInTheDocument();
  expect(client.cancelCoachingPreview).toHaveBeenCalledWith("test-preview");
  await user.click(screen.getByRole("button", {name: "Preview feedback test"}));
  await user.click(await screen.findByRole("button", {name: /Send sample text/}));
  expect(client.requestCoaching).toHaveBeenCalledOnce();
  expect(client.requestCoaching).toHaveBeenCalledWith("test-preview", "a".repeat(64));
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", {name: /Send sample text/})).not.toBeInTheDocument();
  expect(client.requestCoaching).toHaveBeenCalledOnce(); // no automatic retry
});
