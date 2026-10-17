import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { AttemptTranscript } from "@/lib/ipc/schemas";
import { factsBuilder } from "@/test/fixtures/facts";
import { renderWithApp } from "@/test/render";
import { CatchItPage } from "./CatchItPage";

const segment = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs, timingSource: "Estimated" as const, timingUnavailableReason: null });
const filler = (seg: number, decision: "confirmed" | "dismissed" | null) => ({ segment: seg, word: "um", segmentStartMs: null, wordStartMs: null, wordEndMs: null, decision });
const transcript: AttemptTranscript = {
  attemptId: "take-1", correction: null, job: null,
  revision: {
    id: "rev-1", source: "local", provider: null, modelId: "base", backend: "cpu", prompt: null, language: "en", text: "…", workerElapsedMs: 1, createdAt: "2026-10-16T08:00:00Z",
    segments: [segment("Um, so the first thing I do", 0, 3_000), segment("is um plan the day", 3_000, 6_000), segment("and then, um, I start.", 6_000, 9_000)],
    measures: {
      definitionVersion: 2, source: "Estimated", wordCount: 20, speechSpanMs: 9_000, paceWpm: 120, paceUnavailableReason: null, pauseThresholdMs: 700, pauses: [], pausesUnavailableReason: null,
      fillers: [filler(0, "confirmed"), filler(1, "confirmed"), filler(2, "confirmed"), filler(2, "dismissed")], repeatedWords: [], untimedSegments: 0, voice: null,
    },
  },
};

function setup() {
  const facts = factsBuilder("2026-10-16").session().take({ transcribed: true, fillersReviewed: true, fillersConfirmed: 3, fillerCandidates: 4, durationMs: 9_000 }).build();
  const take = { ...facts.takes[0], id: "take-1" };
  const client = {
    ...createMockClient(), recordingMode: "native" as const,
    getPracticeFacts: async () => ({ ...facts, takes: [take] }),
    getAttemptTranscript: async () => transcript,
    getRecordingPlaybackUrl: async () => "blob:take-1",
    saveCatchRun: vi.fn(async (attemptId: string, presses: number[], caught: number, total: number) => ({ id: "catch-1", attemptId, presses, caught, total, createdAt: "2026-10-16T09:00:00Z" })),
  } satisfies IpcClient;
  renderWithApp(<CatchItPage />, { client, path: "/catch-it" });
  return client;
}

// jsdom has no playback: play and pause flip `paused` and send their events.
beforeEach(() => {
  const paused = new WeakMap<HTMLMediaElement, boolean>();
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function (this: HTMLMediaElement) { return paused.get(this) ?? true; });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async function (this: HTMLMediaElement) { paused.set(this, false); this.dispatchEvent(new Event("play")); });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) { paused.set(this, true); this.dispatchEvent(new Event("pause")); });
});
afterEach(() => vi.restoreAllMocks());

const pressF = () => fireEvent.keyDown(window, { key: "f" });

describe("Catch it (11.6)", () => {
  it("lists reviewed takes with enough confirmed fillers", async () => {
    setup();
    const row = (await screen.findByText(/3 confirmed fillers/)).closest("li")!;
    expect(row).toHaveTextContent("Take 1");
    expect(within(row).getByRole("button", { name: /Play/ })).toBeInTheDocument();
  });

  it("F records a press only while playing", async () => {
    const user = userEvent.setup();
    setup();
    await user.click((await screen.findAllByRole("button", { name: /^Play / }))[0]);
    const play = await screen.findByRole("button", { name: "Play your take" });
    const count = screen.getByText(/presses?$/);
    pressF();
    expect(count).toHaveTextContent("0 presses");
    expect(screen.getByRole("button", { name: "Caught one" })).toBeDisabled();
    await user.click(play);
    pressF();
    expect(count).toHaveTextContent("1 press");
    await user.click(screen.getByRole("button", { name: "Caught one" }));
    expect(count).toHaveTextContent("2 presses");
    await user.click(screen.getByRole("button", { name: "Pause your take" }));
    pressF();
    expect(count).toHaveTextContent("2 presses");
  });

  it("hides the transcript while playing and shows the timeline after", async () => {
    const user = userEvent.setup();
    const client = setup();
    await user.click((await screen.findAllByRole("button", { name: /^Play / }))[0]);
    await user.click(await screen.findByRole("button", { name: "Play your take" }));
    // No words of the take and no result while it plays.
    expect(screen.queryByText(/first thing I do/)).toBeNull();
    expect(screen.queryByText(/You caught/)).toBeNull();
    pressF();
    fireEvent(document.querySelector("audio")!, new Event("ended"));
    expect(await screen.findByRole("heading", { name: "You caught 1 of 3" })).toBeInTheDocument();
    expect(screen.getByText("Estimated")).toBeInTheDocument();
    expect(screen.getAllByText("Not caught this time")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /Listen/ }).map((b) => b.textContent?.trim())).toEqual(["Listen from 0:00", "Listen from 0:03", "Listen from 0:06"]);
    await waitFor(() => expect(client.saveCatchRun).toHaveBeenCalledWith("take-1", [0], 1, 3));
    expect(await screen.findByText("Saved with this take.")).toBeInTheDocument();
    expect(screen.queryByText(/first thing I do/)).toBeNull();
  });

  it("keeps a run only when you heard the whole take", async () => {
    const user = userEvent.setup();
    const client = setup();
    await user.click((await screen.findAllByRole("button", { name: /^Play / }))[0]);
    await user.click(await screen.findByRole("button", { name: "Play your take" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("heading", { name: "You caught 0 of 3" })).toBeInTheDocument();
    expect(screen.getByText(/Not saved: a run is kept when you listen to the whole take/)).toBeInTheDocument();
    expect(client.saveCatchRun).not.toHaveBeenCalled();
  });
});
