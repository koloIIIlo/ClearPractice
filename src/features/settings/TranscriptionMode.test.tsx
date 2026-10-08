import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { TranscriptionPreference } from "@/lib/ipc/schemas";
import { TranscriptionMode } from "./TranscriptionMode";

it("stores the default mode and provider, and choosing Cloud sends nothing", async () => {
  const user = userEvent.setup();
  let stored: TranscriptionPreference = { mode: "local", provider: "deepgram" };
  const client: IpcClient = {
    ...createMockClient(),
    recordingMode: "native",
    getTranscriptionPreference: async () => stored,
    setTranscriptionPreference: vi.fn(async (next: TranscriptionPreference) => (stored = next)),
    getTranscriptionApiKeys: async () => [{ provider: "deepgram" as const, present: true }, { provider: "assemblyai" as const, present: false }],
    previewApiTranscription: vi.fn(),
    requestApiTranscription: vi.fn(),
  };
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><TranscriptionMode /></IpcContext.Provider></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole("radio", { name: /On this computer/ })).toBeChecked());
  await user.click(screen.getByRole("radio", { name: /Cloud API/ }));
  expect(client.setTranscriptionPreference).toHaveBeenLastCalledWith({ mode: "api", provider: "deepgram" });
  expect(await screen.findByText(/key not stored yet/)).toBeInTheDocument(); // AssemblyAI
  await user.click(screen.getByRole("radio", { name: /AssemblyAI/ }));
  expect(client.setTranscriptionPreference).toHaveBeenLastCalledWith({ mode: "api", provider: "assemblyai" });
  expect(client.previewApiTranscription).not.toHaveBeenCalled();
  expect(client.requestApiTranscription).not.toHaveBeenCalled();
});
