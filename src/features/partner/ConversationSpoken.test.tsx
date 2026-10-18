import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ConversationView, PartnerPreview } from "@/lib/ipc/schemas";
import { controlledRecording } from "@/test/drill-harness";
import { conversationInput, partnerClient, READY_QUEUE, renderConversation } from "./test-utils";

class FakeUtterance {
  text: string;
  voice: unknown = null;
  lang = "";
  rate = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const LONG = { timeout: 4_000 };

it("disables recording while the partner speaks and Record stops the speech", async () => {
  const user = userEvent.setup();
  // An offline voice that keeps speaking until it is stopped.
  const synth = { getVoices: () => [{ name: "Microsoft David", lang: "en-US", localService: true }], speak: vi.fn(), cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  const client = await partnerClient();
  const start = vi.spyOn(client, "startRecording");
  const view = await client.startConversation(conversationInput("scripted"));
  renderConversation(client, view.conversation.id, "", READY_QUEUE);
  // The opening is spoken (and captioned); nothing records meanwhile.
  await waitFor(() => expect(synth.speak).toHaveBeenCalledTimes(1));
  expect((synth.speak.mock.calls[0][0] as FakeUtterance).text).toBe(view.turns[0].text);
  const record = await screen.findByRole("button", { name: "Stop the partner and record" });
  await waitFor(() => expect(record).toBeEnabled());
  expect(start).not.toHaveBeenCalled();
  const cancels = synth.cancel.mock.calls.length;
  await user.click(record);
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(synth.cancel.mock.calls.length).toBeGreaterThan(cancels);
  expect(synth.cancel.mock.invocationCallOrder.at(-1)!).toBeLessThan(start.mock.invocationCallOrder[0]);
  expect(start.mock.calls[0][0].context).toMatchObject({ sessionId: view.conversation.sessionId, exerciseType: "conversation", prompt: view.conversation.sessionPrompt, step: { index: 2, key: "turn" } });
});

it("stops at the level's limit and tells the partner you ran out of time", async () => {
  const user = userEvent.setup();
  const { client, tick } = controlledRecording();
  const view = await client.startConversation(conversationInput("scripted", { pressure: 2 }));
  const original = client.addLearnerTurn;
  const add = vi.fn((id: string, _answer: Parameters<typeof original>[1]) => original(id, { typedText: "We moved the reports first." }));
  client.addLearnerTurn = add;
  client.getAttemptTranscript = vi.fn(async (attemptId: string) => ({ attemptId, revision: { id: `${attemptId}-r1` }, correction: null, job: null }) as never);
  renderConversation(client, view.conversation.id, "", READY_QUEUE);
  expect(await screen.findByText("Your answer stops by itself after 60 seconds.")).toBeInTheDocument();
  const record = screen.getByRole("button", { name: "Record your answer" });
  await waitFor(() => expect(record).toBeEnabled());
  await user.click(record);
  await waitFor(() => expect(client.startRecording).toHaveBeenCalledTimes(1));
  tick(30_000);
  expect(client.stopRecording).not.toHaveBeenCalled();
  tick(60_000);
  await waitFor(() => expect(client.stopRecording).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
  expect(add.mock.calls[0][1]).toMatchObject({ outOfTime: true });
  expect(add.mock.calls[0][1].attemptId).toBeTruthy();
  expect(await screen.findByText("Time. Your answer was saved.")).toBeInTheDocument();
  // Once: the limit never stops a take twice.
  tick(70_000);
  expect(client.stopRecording).toHaveBeenCalledTimes(1);
});

it("needs a fresh preview after Fix transcript", async () => {
  const user = userEvent.setup();
  const client = await partnerClient();
  const started = await client.startConversation(conversationInput("api"));
  const spoken = { ...started.turns[0], id: "turn-spoken", ordinal: 2, role: "learner" as const, text: "I like to test early.", move: null, attemptId: "take-1", revisionId: "rev-1", takeAvailable: true, durationMs: 12_000 };
  let view: ConversationView = { ...started, turns: [started.turns[0], spoken], learnerTurns: 1, next: "partner" };
  client.getConversation = vi.fn(async () => view);
  let n = 0;
  const preview = vi.fn(async (): Promise<PartnerPreview> => ({
    version: 1, requestId: `partner-${++n}`, payloadSha256: "a".repeat(64), recipient: "https://api.openai.com/v1/responses", model: "gpt-6-luna",
    selectedText: `Learner: ${view.turns[1].text}`, prompt: "", focus: "", instructions: "", maximumOutputTokens: 400, estimatedMaximumCostMicroUsd: 3_000,
    priceDate: "", priceSource: "", inputUsdPerMillionTokens: "0.10", outputUsdPerMillionTokens: "0.50", costExplanation: "", expiresAtMs: 0, conversationSpentMicroUsd: 0, capMicroUsd: 50_000,
  }));
  client.previewPartnerTurn = preview;
  const cancel = vi.fn(async () => {});
  client.cancelCoachingPreview = cancel;
  const request = vi.spyOn(client, "requestPartnerTurn");
  client.getAttemptTranscript = vi.fn(async () => ({ attemptId: "take-1", revision: { id: "rev-1" }, correction: null, job: null }) as never);
  const correct = vi.fn(async () => "rev-2");
  client.saveTranscriptCorrection = correct;
  client.addLearnerTurn = vi.fn(async () => {
    view = { ...view, turns: [started.turns[0], { ...spoken, revisionId: "rev-2", text: "I like to test things early." }] };
    return view;
  });
  renderConversation(client, started.conversation.id, "", READY_QUEUE);
  const bar = await screen.findByRole("region", { name: "Send bar" }, LONG);
  expect(within(bar).getByText("Learner: I like to test early.", { exact: false })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Fix transcript" }));
  const field = screen.getByRole("textbox", { name: "Your words, as you said them" });
  await user.clear(field);
  await user.type(field, "I like to test things early.");
  await user.click(screen.getByRole("button", { name: "Save the correction" }));
  await waitFor(() => expect(correct).toHaveBeenCalledWith("take-1", "rev-1", "I like to test things early."));
  // The old approval is discarded; a new preview shows the corrected words.
  await waitFor(() => expect(cancel).toHaveBeenCalledWith("partner-1"));
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Learner: I like to test things early.", { exact: false }, LONG)).toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
});
