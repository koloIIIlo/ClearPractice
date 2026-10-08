import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { ReferenceClip } from "@/lib/ipc/schemas";
import { ClipImport } from "./ClipImport";

const saved = (title: string): ReferenceClip => ({ id: `clip-${title}`, origin: "user", title, source: "s", transcript: null, durationMs: 12_000, sha256: "a".repeat(64), createdAtMs: 1 });

function setup(overrides: Partial<IpcClient>) {
  const onSaved = vi.fn();
  const client: IpcClient = {
    ...createMockClient(),
    recordingMode: "native",
    getClipStagingUrl: async () => "http://asset.localhost/full.wav",
    discardClipStaging: vi.fn(async () => {}),
    ...overrides,
  };
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><ClipImport onSaved={onSaved} onCancel={vi.fn()} /></IpcContext.Provider></QueryClientProvider>);
  return { client, onSaved };
}

it("splits a long recording into proposed clips, lets the user untick and rename, and saves the rest together (4.4c)", async () => {
  const user = userEvent.setup();
  const { client, onSaved } = setup({
    chooseClipFile: async () => ({ stagingId: "stage-1", fileName: "talk.m4a", durationMs: 900_000 }),
    splitClipSource: vi.fn(async () => [
      { startMs: 6_000, endMs: 17_800, text: "Imagine you are sitting in a grassy field. That does not sound very interesting.", title: "Imagine you are sitting in a grassy field." },
      { startMs: 20_000, endMs: 33_000, text: "In fact, it sounds really boring.", title: "In fact, it sounds really boring." },
    ]),
    saveClipSections: vi.fn(async (_id: string, sections: { title: string }[]) => sections.map((s) => saved(s.title))),
  });
  await user.click(screen.getByRole("button", { name: "Choose an audio file…" }));
  await screen.findByText("talk.m4a · 15:00");
  await user.type(screen.getByLabelText("Source and credit"), "A Speaker, A Talk, 2024");
  await user.click(screen.getByRole("button", { name: "Transcribe and split" }));
  expect(client.splitClipSource).toHaveBeenCalledWith("stage-1");
  expect(await screen.findByText("2 clips found. Untick any you don't want, and rename them if you like.")).toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "Keep clip 2" }));
  await user.clear(screen.getByLabelText("Title of clip 1"));
  await user.type(screen.getByLabelText("Title of clip 1"), "Grassy field");
  await user.click(screen.getByRole("button", { name: "Save 1 clip" }));
  expect(client.saveClipSections).toHaveBeenCalledWith("stage-1", [
    { startMs: 6_000, endMs: 17_800, title: "Grassy field", source: "A Speaker, A Talk, 2024", transcript: "Imagine you are sitting in a grassy field. That does not sound very interesting.", description: null, feature: null },
  ]);
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith([saved("Grassy field")]));
});

it("explains how to get yt-dlp when it is missing, and fills the credit from a fetched YouTube link (4.4d)", async () => {
  const user = userEvent.setup();
  const missing = setup({ getLinkToolStatus: async () => ({ available: false, path: null }) });
  expect(await screen.findByText(/winget install yt-dlp.yt-dlp/)).toBeInTheDocument();
  expect(screen.getByLabelText("YouTube link")).toBeDisabled();
  expect(missing.client.fetchLinkAudio).toBeDefined();
  document.body.innerHTML = "";

  const { client } = setup({
    getLinkToolStatus: async () => ({ available: true, path: "C:/tools/yt-dlp.exe" }),
    fetchLinkAudio: vi.fn(async () => ({
      staged: { stagingId: "stage-2", fileName: "source.m4a", durationMs: 600_000 },
      title: "A Talk", uploader: "A Speaker", url: "https://www.youtube.com/watch?v=abc",
      source: "A Speaker, “A Talk”, YouTube — https://www.youtube.com/watch?v=abc",
    })),
  });
  expect(await screen.findByText(/only use videos you have the right to keep/)).toBeInTheDocument();
  await user.type(screen.getByLabelText("YouTube link"), "https://www.youtube.com/watch?v=abc");
  await user.click(screen.getByRole("button", { name: /Get audio/ }));
  expect(client.fetchLinkAudio).toHaveBeenCalledWith("https://www.youtube.com/watch?v=abc");
  expect(await screen.findByText("source.m4a · 10:00")).toBeInTheDocument();
  expect(screen.getByLabelText("Source and credit")).toHaveValue("A Speaker, “A Talk”, YouTube — https://www.youtube.com/watch?v=abc");
  expect(screen.getByLabelText("Title")).toHaveValue("A Talk");
});

it("splits with a cloud provider only after the usual preview and an explicit Send (4.4c)", async () => {
  const user = userEvent.setup();
  const { client } = setup({
    chooseClipFile: async () => ({ stagingId: "stage-3", fileName: "talk.mp3", durationMs: 300_000 }),
    getTranscriptionPreference: async () => ({ mode: "api" as const, provider: "deepgram" as const }),
    getTranscriptionApiKeys: async () => [{ provider: "deepgram" as const, present: true }, { provider: "assemblyai" as const, present: false }],
    previewSplitTranscription: vi.fn(async () => ({
      requestId: "api-deepgram-9", provider: "deepgram" as const, providerLabel: "Deepgram", model: "nova-3", recipient: "api.deepgram.com",
      attemptId: "stage-3", durationMs: 300_000, bytes: 9_600_044, audioSha256: "a".repeat(64), settings: {}, estimatedCostMicroUsd: 21_500,
      priceSource: "https://deepgram.com/pricing", priceDate: "2026-10-08", dataHandling: "Sent with mip_opt_out=true.", payloadSha256: "b".repeat(64),
    })),
    requestSplitTranscription: vi.fn(async () => [{ startMs: 1_000, endMs: 13_000, text: "A whole sentence here.", title: "A whole sentence here." }]),
    splitClipSource: vi.fn(),
  });
  await user.click(screen.getByRole("button", { name: "Choose an audio file…" }));
  await screen.findByText("talk.mp3 · 5:00");
  await waitFor(() => expect(screen.getByRole("radio", { name: "Cloud API" })).toBeChecked());
  await user.click(await screen.findByRole("button", { name: "Preview request" }));
  expect(client.previewSplitTranscription).toHaveBeenCalledWith("stage-3", "deepgram");
  expect(client.requestSplitTranscription).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Send to Deepgram Nova-3 · may be billed" }));
  expect(client.requestSplitTranscription).toHaveBeenCalledWith("api-deepgram-9", "b".repeat(64));
  expect(await screen.findByText("1 clip found. Untick any you don't want, and rename them if you like.")).toBeInTheDocument();
  expect(client.splitClipSource).not.toHaveBeenCalled();
});

it("suggests titles, descriptions and features with AI only after a preview of the transcripts and an explicit Send", async () => {
  const user = userEvent.setup();
  const { client } = setup({
    chooseClipFile: async () => ({ stagingId: "stage-4", fileName: "talk.wav", durationMs: 120_000 }),
    getApiKeyStatus: async () => ({ provider: "OpenAI" as const, present: true }),
    splitClipSource: async () => [
      { startMs: 0, endMs: 12_000, text: "First whole sentence here.", title: "First whole sentence here." },
      { startMs: 13_000, endMs: 25_000, text: "Second whole sentence here.", title: "Second whole sentence here." },
    ],
    previewClipNames: vi.fn(async (texts: string[]) => ({
      version: 1 as const, requestId: "naming-1", payloadSha256: "c".repeat(64), recipient: "https://api.openai.com/v1/responses" as const, model: "gpt-6-luna",
      selectedText: texts.map((t, i) => `${i + 1}. ${t}`).join(" | "), prompt: "p", focus: "f", instructions: "i", maximumOutputTokens: 2048,
      estimatedMaximumCostMicroUsd: 5_000, priceDate: "2026-10-08", priceSource: "https://developers.openai.com/api/docs/models/gpt-6-luna",
      inputUsdPerMillionTokens: "0.10", outputUsdPerMillionTokens: "0.50", costExplanation: "c", expiresAtMs: Date.now() + 300_000,
    })),
    requestClipNames: vi.fn(async () => [{ index: 2, title: "A second idea", description: "Clear falling end.", feature: "endings" as const }]),
    saveClipSections: vi.fn(async () => []),
  });
  await user.click(screen.getByRole("button", { name: "Choose an audio file…" }));
  await user.click(await screen.findByRole("button", { name: "Transcribe and split" }));
  await user.click(await screen.findByRole("button", { name: "Suggest titles with AI…" }));
  expect(client.previewClipNames).toHaveBeenCalledWith(["First whole sentence here.", "Second whole sentence here."], "gpt-6-luna");
  const box = await screen.findByRole("group", { name: "AI naming request preview" });
  expect(box).toHaveTextContent("never audio");
  expect(client.requestClipNames).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Send transcripts · may be billed" }));
  expect(client.requestClipNames).toHaveBeenCalledWith("naming-1", "c".repeat(64));
  await waitFor(() => expect(screen.getByLabelText("Title of clip 2")).toHaveValue("A second idea"));
  expect(screen.getByLabelText("Title of clip 1")).toHaveValue("First whole sentence here."); // untouched
  expect(screen.getByLabelText("Description of clip 2")).toHaveValue("Clear falling end.");
  expect(screen.getByText("AI suggestion · edit freely")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save 2 clips" }));
  expect(client.saveClipSections).toHaveBeenCalledWith("stage-4", expect.arrayContaining([
    expect.objectContaining({ title: "A second idea", description: "Clear falling end.", feature: "endings" }),
  ]));
});
