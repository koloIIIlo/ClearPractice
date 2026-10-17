import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PhrasesPage } from "@/features/phrases/PhrasesPage";
import type { AttemptTranscript, PhraseCard } from "@/lib/ipc/schemas";
import { withFakeToday } from "@/test/clock";
import { controlledRecording } from "@/test/drill-harness";
import { factsBuilder } from "@/test/fixtures/facts";
import { renderWithRouter } from "@/test/render";

const today = "2026-10-20";
const card: PhraseCard = { id: "phrase-1", original: "I forgot the time", expression: "lose track of time", explanation: "", examples: [], dueDate: today, intervalDays: 1, sourceSessionId: null };
const transcriptFor = (attemptId: string): AttemptTranscript => ({
  attemptId, correction: null, job: null,
  revision: {
    id: `rev-${attemptId}`, source: "local", provider: null, modelId: "base", backend: "cpu", prompt: null, language: "en", text: "I always lose track of time.", workerElapsedMs: 1, createdAt: `${today}T09:00:00Z`,
    segments: [{ text: "I always lose track of time.", startMs: 0, endMs: 3_000, timingSource: "Estimated", timingUnavailableReason: null }],
    measures: {
      definitionVersion: 2, source: "Estimated", wordCount: 6, speechSpanMs: 3_000, paceWpm: null, paceUnavailableReason: "too short", pauseThresholdMs: 700,
      pauses: [], pausesUnavailableReason: null, fillers: [], repeatedWords: [], untimedSegments: 0, voice: null,
    },
  },
});

/** Phrases → review with one due card, a recorder the test controls, and transcripts that are ready. */
function setup({ spotted, existingSession }: { spotted: boolean; existingSession?: string }) {
  const { client, tick } = controlledRecording();
  let facts = factsBuilder(today);
  if (existingSession) facts = facts.session({ id: existingSession, exerciseType: "phrase_say_it" }).take();
  const built = facts.build();
  const recorded = () => client.stopRecording.mock.calls.map(([id]) => id);
  const reviewPhrase = vi.fn(async () => card);
  const full = {
    ...client,
    listPhrases: async () => [card],
    reviewPhrase,
    getPracticeFacts: async () => built,
    getAttemptTranscript: async (attemptId: string) => (recorded().includes(attemptId) ? transcriptFor(attemptId) : { attemptId, revision: null, correction: null, job: null }),
    listPhraseUses: async () => (spotted ? recorded().map((attemptId) => ({ phraseId: card.id, attemptId, sessionId: "s", revisionId: `rev-${attemptId}`, segment: 0, localDate: today })) : []),
  };
  const view = renderWithRouter([{ path: "/phrases", element: <PhrasesPage /> }], { client: full, path: "/phrases?review=1" });
  return { ...view, client: full, tick, reviewPhrase };
}

async function sayIt(tick: (ms: number) => void, startRecording: ReturnType<typeof vi.fn>) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Reveal" }));
  await user.click(screen.getByRole("button", { name: "Say it" }));
  expect(screen.getByText(/Say a sentence of your own using/)).toHaveTextContent("Say a sentence of your own using lose track of time.");
  const record = await screen.findByRole("button", { name: "Record" }, { timeout: 8_000 });
  await waitFor(() => expect(record).toBeEnabled());
  await user.click(record);
  await waitFor(() => expect(startRecording).toHaveBeenCalled());
  act(() => tick(4_000));
  await user.click(screen.getByRole("button", { name: /Stop and save/ }));
  return user;
}

describe("Phrases: Say it (11.7)", () => {
  it("records into today's phrase practice session", async () => {
    await withFakeToday(today, async () => {
      const { client, tick } = setup({ spotted: true, existingSession: "session-today" });
      await sayIt(tick, client.startRecording);
      const context = client.startRecording.mock.calls[0][0].context!;
      expect([context.sessionId, context.exerciseType, context.exerciseId, context.exerciseVersion]).toEqual(["session-today", "phrase_say_it", "ex-phrase-say-it", 1]);
      // The compact recorder: no microphone picker, a link to change it.
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.getByRole("link", { name: "Change microphone" })).toHaveAttribute("href", "/settings/audio");
    });
  });

  it("stops by itself at 20 seconds", async () => {
    await withFakeToday(today, async () => {
      const { client, tick } = setup({ spotted: true });
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: "Reveal" }));
      await user.click(screen.getByRole("button", { name: "Say it" }));
      const record = await screen.findByRole("button", { name: "Record" }, { timeout: 8_000 });
      await waitFor(() => expect(record).toBeEnabled());
      await user.click(record);
      await waitFor(() => expect(client.startRecording).toHaveBeenCalled());
      act(() => tick(19_900));
      expect(client.stopRecording).not.toHaveBeenCalled();
      act(() => tick(20_000));
      act(() => tick(20_100));
      await waitFor(() => expect(client.stopRecording).toHaveBeenCalledTimes(1));
    });
  });

  it("shows spotted or not found after transcription", async () => {
    await withFakeToday(today, async () => {
      const spotted = setup({ spotted: true });
      await sayIt(spotted.tick, spotted.client.startRecording);
      const line = await screen.findByText(/Phrase spotted in your sentence/);
      expect(within(line).getByText("Estimated")).toBeInTheDocument();
      spotted.unmount();

      const missed = setup({ spotted: false });
      await sayIt(missed.tick, missed.client.startRecording);
      expect(await screen.findByText(/Not found; you can still rate it/)).toBeInTheDocument();
    });
  });

  it("never rates for you", async () => {
    await withFakeToday(today, async () => {
      const { client, tick, reviewPhrase } = setup({ spotted: true });
      const user = await sayIt(tick, client.startRecording);
      await screen.findByText(/Phrase spotted in your sentence/);
      expect(reviewPhrase).not.toHaveBeenCalled();
      for (const name of [/^Again/, /^Hard/, /^Good/]) expect(screen.getByRole("button", { name })).toBeEnabled();
      await user.click(screen.getByRole("button", { name: /^Hard/ }));
      await waitFor(() => expect(reviewPhrase).toHaveBeenCalledWith(card.id, "hard"));
    });
  });
});
