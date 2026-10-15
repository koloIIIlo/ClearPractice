import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { sessions } from "@/lib/ipc/mock-data";
import type { AttemptTranscript, SessionDetail } from "@/lib/ipc/schemas";
import { NativeCompare } from "./NativeCompare";

const take = (id: string, ordinal: number, durationMs: number) =>
  ({ id, ordinal, captureState: "saved" as const, analysisState: null, durationMs, createdAt: "2026-10-09T08:00:00.000Z", firstTake: ordinal === 1, audioUnavailableReason: null });

const transcript = (attemptId: string, text: string, paceWpm: number | null): AttemptTranscript => ({
  attemptId, correction: null, job: null,
  revision: {
    id: `${attemptId}--1`, source: "local", provider: "whisper.cpp", modelId: "base", backend: "cpu", prompt: null, language: "en", text,
    workerElapsedMs: 1, createdAt: "2026-10-09T08:00:00.000Z", segments: [],
    measures: {
      definitionVersion: 1, source: "Estimated", wordCount: text.split(" ").length, speechSpanMs: 20_000, paceWpm, paceUnavailableReason: paceWpm === null ? "Too short." : null,
      pauseThresholdMs: 700, pauses: [], pausesUnavailableReason: null, fillers: [{ segment: 0, word: "uh", segmentStartMs: 0, wordStartMs: null, wordEndMs: null, decision: null }], repeatedWords: [], untimedSegments: 0,
      voice: { method: "peak-energy-v1", source: "Estimated", speechStartMs: 0, speechEndMs: 1, pauses: [{ afterSegment: 0, startMs: 1, durationMs: 800 }], unavailableReason: null },
    },
  },
});

function setup(session: SessionDetail) {
  const client: IpcClient = {
    ...createMockClient(),
    recordingMode: "native",
    getAttemptTranscript: async (id) => (id === "t2" ? { attemptId: id, revision: null, correction: null, job: null } : transcript(id, id === "t1" ? "So uh the index helps." : "The index makes reads faster.", id === "t3" ? 132 : null)),
    setPreferredTake: vi.fn(async () => {}),
  };
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IpcContext.Provider value={client}>
          <NativeCompare session={session} />
        </IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}

const base = { ...structuredClone(sessions[0]), id: "s1", attempts: [take("t1", 1, 40_000), take("t2", 2, 42_000), take("t3", 3, 38_000)] } as SessionDetail;

it("compares the first and last take side by side and saves which felt clearer as your own judgement (4.14)", async () => {
  const user = userEvent.setup();
  const client = setup(base);
  expect(await screen.findByText("So uh the index helps.")).toBeInTheDocument();
  expect(screen.getByText("The index makes reads faster.")).toBeInTheDocument();
  const table = screen.getByRole("table");
  const row = (name: string) => within(table).getByRole("rowheader", { name }).closest("tr")!;
  expect(within(row("Duration")).getAllByRole("cell").map((c) => c.textContent)).toEqual(["0:40", "0:38", "Measured"]);
  expect(within(row("Pace")).getAllByRole("cell")[0]).toHaveTextContent("Unavailable");
  expect(within(row("Pace")).getAllByRole("cell")[1]).toHaveTextContent("132 wpm");
  expect(within(row("Pauses over 0.7 s")).getAllByRole("cell")[0]).toHaveTextContent("1");
  expect(screen.getByRole("button", { name: "Play take 1, then take 3" })).toBeInTheDocument();
  // A take cannot be compared with itself.
  await user.click(screen.getByLabelText("Second take"));
  expect(await screen.findByRole("option", { name: /Take 1/ })).toHaveAttribute("aria-disabled", "true");
  await user.click(screen.getByRole("option", { name: /Take 2/ }));
  expect(await screen.findByText(/Not transcribed yet/)).toBeInTheDocument();
  expect(within(row("Words")).getAllByRole("cell")[1]).toHaveTextContent("Not transcribed");

  await user.click(screen.getByRole("radio", { name: "About the same" }));
  expect(client.setPreferredTake).toHaveBeenCalledWith("s1", "same");
  await user.click(screen.getByRole("radio", { name: "Take 2" }));
  expect(client.setPreferredTake).toHaveBeenLastCalledWith("s1", "t2");
});

it("asks for a second take when there is only one", () => {
  setup({ ...base, attempts: [take("t1", 1, 40_000)] });
  expect(screen.getByText(/Record at least two takes/)).toBeInTheDocument();
});
