import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { DEFAULT_PREFERENCES, type AttemptTranscript, type CoachingRun, type TakeCoachingPreview } from "@/lib/ipc/schemas";
import { TakeCoaching } from "./TakeCoaching";

const transcript: AttemptTranscript = {
  attemptId: "take-1",
  correction: null,
  job: null,
  revision: {
    id: "take-1--1", source: "local", provider: "whisper.cpp", modelId: "base", backend: "cpu", prompt: null, language: "en",
    text: "I want to be more clear.", workerElapsedMs: 1_000, createdAt: "2026-10-09T08:00:00.000Z",
    segments: [{ text: "I want to be more clear.", startMs: 0, endMs: 2_000, timingSource: "Estimated", timingUnavailableReason: null }],
    measures: {
      definitionVersion: 1, source: "Estimated", wordCount: 6, speechSpanMs: 2_000, paceWpm: null, paceUnavailableReason: "Too short.",
      pauseThresholdMs: 700, pauses: [], pausesUnavailableReason: null, fillers: [], repeatedWords: [], untimedSegments: 0, voice: null,
    },
  },
};

const preview = (answeredAt: string | null): TakeCoachingPreview => ({
  preview: {
    version: 1, requestId: "take-coaching-1", payloadSha256: "a".repeat(64), recipient: "https://api.openai.com/v1/responses", model: "gpt-6-luna",
    selectedText: "Task: Explain an idea\n\nTranscript (automatic transcription):\nI want to be more clear.", prompt: "Feedback on one recorded take",
    focus: "Wording and one improvement", instructions: "You are a concise English speaking-practice coach.", maximumOutputTokens: 2048,
    estimatedMaximumCostMicroUsd: 9_000, priceDate: "2026-10-08", priceSource: "https://developers.openai.com/api/docs/models/gpt-6-luna",
    inputUsdPerMillionTokens: "0.10", outputUsdPerMillionTokens: "0.50", costExplanation: "Only the text below is sent, never audio.", expiresAtMs: 1,
  },
  answeredAt, timedParts: 1, corrected: false, revisionId: "take-1--1",
});

const run = (revisionId: string): CoachingRun => ({
  id: "take-coaching-1", attemptId: "take-1", revisionId, provider: "OpenAI", model: "gpt-6-luna", payloadSha256: "a".repeat(64),
  sentText: "Task: Explain an idea", transcriptText: "I want to be more clear.", deliveryImpressions: true,
  feedback: {
    summary: "Your point is easy to follow.", oneImprovement: "Say the conclusion first.", nextAttempt: "Start with one sentence that answers the question.",
    corrections: [{ kind: "style", quote: "more clear", suggestion: "clearer", reason: "Shorter and more natural." }],
    phrases: [{ instead: "I want to be more clear", expression: "Let me put it more simply", why: "Before you rephrase a point." }],
    deliveryNotes: [{ part: 1, note: "The ending rises +2.4 st, so it may sound like a question." }],
  },
  inputTokens: 300, outputTokens: 120, estimatedCostMicroUsd: null, costUnavailableReason: "The provider did not report usage; the full reservation stays counted.",
  createdAt: "2026-10-09T09:15:00.000Z",
});

function setup(overrides: Partial<IpcClient>) {
  const base = createMockClient();
  const client: IpcClient = {
    ...base,
    recordingMode: "native",
    getAttemptTranscript: async () => transcript,
    getApiKeyStatus: async () => ({ provider: "OpenAI", present: true }),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IpcContext.Provider value={client}>
          <TakeCoaching attemptId="take-1" sessionId="s1" />
        </IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}

it("previews the exact text, sends only on Send, and shows the stored feedback as an AI suggestion (M5, P.9)", async () => {
  const user = userEvent.setup();
  let stored: CoachingRun[] = [];
  const client = setup({
    listTakeCoaching: vi.fn(async () => stored),
    previewTakeCoaching: vi.fn(async () => preview(null)),
    requestTakeCoaching: vi.fn(async () => { stored = [run("take-1--1")]; return stored[0]; }),
    addPhrase: vi.fn(async (input) => ({ id: "ph-1", ...input, dueDate: "2026-10-09", intervalDays: 0, sourceSessionId: "s1" })),
  });
  await user.click(await screen.findByRole("button", { name: "Get AI feedback…" }));
  // Delivery impressions are off by default (D-27).
  expect(screen.getByRole("switch", { name: "Delivery impressions (experimental)" })).not.toBeChecked();
  await user.click(screen.getByRole("switch", { name: "Delivery impressions (experimental)" }));
  await user.type(screen.getByLabelText(/Hide words before sending/), "Anna, Acme ,");
  await user.click(screen.getByRole("button", { name: "Preview request" }));
  expect(client.previewTakeCoaching).toHaveBeenCalledWith("take-1", { model: DEFAULT_PREFERENCES.coachingModel, deliveryImpressions: true, hide: ["Anna", "Acme"] });
  const card = await screen.findByRole("group", { name: "AI feedback request preview" });
  expect(within(card).getByText(/Transcript \(automatic transcription\):/)).toBeInTheDocument();
  expect(within(card).getByText(/1 timed part with measured delivery/)).toBeInTheDocument();
  expect(client.requestTakeCoaching).not.toHaveBeenCalled();

  await user.click(within(card).getByRole("button", { name: "Send · may be billed" }));
  expect(client.requestTakeCoaching).toHaveBeenCalledWith("take-1", "take-coaching-1", "a".repeat(64));
  const feedback = await screen.findByRole("article");
  expect(within(feedback).getByText("Your point is easy to follow.")).toBeInTheDocument();
  expect(within(feedback).getByText(/“more clear” → “clearer”/)).toBeInTheDocument();
  expect(within(feedback).getByText(/may sound like a question/)).toBeInTheDocument();
  expect(within(feedback).getByText(/did not report usage/)).toBeInTheDocument();
  expect(within(feedback).queryByText(/earlier version/)).not.toBeInTheDocument();
  expect(screen.getByText("AI suggestion")).toBeInTheDocument();
  // Suggested phrases and corrections can be kept as phrase cards.
  expect(within(feedback).getByText(/instead of “I want to be more clear”/)).toBeInTheDocument();
  await user.click(within(feedback).getByRole("button", { name: "Save “Let me put it more simply” to Phrases" }));
  expect(client.addPhrase).toHaveBeenCalledWith({ original: "I want to be more clear", expression: "Let me put it more simply", explanation: "Before you rephrase a point.", examples: [] }, "s1");
  expect(await within(feedback).findByText("Saved to Phrases")).toBeInTheDocument();
  await user.click(within(feedback).getByRole("button", { name: "Save “clearer” to Phrases" }));
  expect(client.addPhrase).toHaveBeenLastCalledWith(expect.objectContaining({ original: "more clear", expression: "clearer" }), "s1");
});

it("says when feedback is from an earlier transcript and labels an identical request as asking again", async () => {
  const user = userEvent.setup();
  setup({
    listTakeCoaching: async () => [run("old-revision")],
    previewTakeCoaching: async () => preview("2026-10-09T09:15:00.000Z"),
  });
  expect(await screen.findByText("Based on an earlier version of the transcript.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Ask again…" }));
  await user.click(screen.getByRole("button", { name: "Preview request" }));
  expect(await screen.findByText(/You asked exactly this on/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Ask again · may be billed" })).toBeEnabled();
});

it("needs a transcript first", async () => {
  setup({ getAttemptTranscript: async () => ({ ...transcript, revision: null }) });
  expect(await screen.findByText(/Transcribe this take first/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Get AI feedback…" })).toBeDisabled();
});

it("is hidden when coaching is set to Off", async () => {
  setup({ getPreferences: async () => ({ ...DEFAULT_PREFERENCES, coachingMode: "off" }) });
  await waitFor(() => expect(screen.queryByRole("region", { name: "AI feedback" })).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: /AI feedback/ })).not.toBeInTheDocument();
});

it("in Local LLM mode, previews a request to this computer that is free and needs no key (5.4)", async () => {
  const user = userEvent.setup();
  const local = preview(null);
  let stored: CoachingRun[] = [];
  local.preview = { ...local.preview, recipient: "http://127.0.0.1:8080/v1/chat/completions", model: "qwen3-8b", estimatedMaximumCostMicroUsd: 0, costExplanation: "Runs on this computer: nothing leaves it and nothing is billed." };
  const client = setup({
    getPreferences: async () => ({ ...DEFAULT_PREFERENCES, coachingMode: "local" }),
    getApiKeyStatus: async () => ({ provider: "OpenAI", present: false }),
    listTakeCoaching: async () => stored,
    previewTakeCoaching: vi.fn(async () => local),
    requestTakeCoaching: vi.fn(async () => { stored = [{ ...run("take-1--1"), provider: "Local LLM" as const, model: "qwen3-8b", estimatedCostMicroUsd: 0, costUnavailableReason: null }]; return stored[0]; }),
  });
  await user.click(await screen.findByRole("button", { name: "Get AI feedback…" }));
  expect(await screen.findByText("Local model on this computer · free")).toBeInTheDocument();
  expect(screen.queryByLabelText("Model")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Preview request" }));
  expect((await screen.findAllByText(/nothing leaves it and nothing is billed/)).length).toBeGreaterThan(0);
  await user.click(screen.getByRole("button", { name: "Send to the local model" }));
  expect(client.requestTakeCoaching).toHaveBeenCalled();
  expect(await screen.findByText(/qwen3-8b \(local\)/)).toBeInTheDocument();
});
