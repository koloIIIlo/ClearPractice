import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { IpcClient } from "@/lib/ipc";
import { DEFAULT_PREFERENCES, type RecordingStatus } from "@/lib/ipc/schemas";
import { expectNoScores } from "@/test/no-scores";
import { renderWithApp } from "@/test/render";
import { CelebrationHost } from "./CelebrationHost";
import { celebrationQueue, celebrationsFrom, limitBatch, type Celebration } from "./celebrations";

const card = (headline: string): Celebration => ({ kind: "achievement", headline, because: "A minute or more with an empty outline.", quiet: false });

function withRecording() {
  const listeners = new Set<(s: RecordingStatus) => void>();
  const client: IpcClient = {
    ...createMockClient(),
    onRecordingEvent: async (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const emit = (phase: RecordingStatus["phase"]) =>
    listeners.forEach((l) => l({ attemptId: "t", phase, elapsedMs: 0, monotonicMs: 0, level: 0, clipping: false, error: null, asset: null }));
  return { client, emit };
}

beforeEach(() => celebrationQueue.clear());

describe("CelebrationHost (9.10)", () => {
  it("shows one card at a time in order", async () => {
    const user = userEvent.setup();
    renderWithApp(<CelebrationHost />);
    act(() => celebrationQueue.enqueue([card("Achievement: First take"), card("Achievement: Third time")]));
    expect(await screen.findByText("Achievement: First take", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText("Achievement: Third time")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("celebration-card")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText("Achievement: Third time", {}, { timeout: 3000 })).toBeInTheDocument();
    expectNoScores();
  });

  it("waits while recording and shows after the take is saved", async () => {
    const { client, emit } = withRecording();
    renderWithApp(<CelebrationHost />, { client });
    await new Promise((r) => setTimeout(r, 20));
    act(() => emit("recording"));
    act(() => celebrationQueue.enqueue([card("Achievement: First take")]));
    await new Promise((r) => setTimeout(r, 1500));
    expect(screen.queryByText("Achievement: First take")).not.toBeInTheDocument();
    act(() => emit("saved"));
    expect(await screen.findByText("Achievement: First take", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("uses a toast in subtle style and nothing when off", async () => {
    const client = createMockClient();
    await client.setPreferences({ ...DEFAULT_PREFERENCES, celebrations: "subtle" });
    const view = renderWithApp(<CelebrationHost />, { client });
    await new Promise((r) => setTimeout(r, 20));
    act(() => celebrationQueue.enqueue([card("Achievement: First take")]));
    expect(await screen.findByText("Achievement: First take", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByTestId("celebration-card")).not.toBeInTheDocument();
    view.unmount();
    const off = createMockClient();
    await off.setPreferences({ ...DEFAULT_PREFERENCES, celebrations: "off" });
    renderWithApp(<CelebrationHost />, { client: off });
    await new Promise((r) => setTimeout(r, 20));
    act(() => celebrationQueue.enqueue([card("Achievement: Keeper")]));
    await new Promise((r) => setTimeout(r, 1500));
    expect(screen.queryByText("Achievement: Keeper")).not.toBeInTheDocument();
  });

  it("summarises more than three", () => {
    const batch = limitBatch([card("a"), card("b"), card("c"), card("d"), card("e")]);
    expect(batch.map((c) => c.headline)).toEqual(["a", "b", "c", "And 2 more in Journey"]);
    expect(batch[3].quiet).toBe(true);
    expect(limitBatch([card("a")])).toHaveLength(1);
  });

  it("never takes focus and closes with Escape", async () => {
    const user = userEvent.setup();
    renderWithApp(<><button>Keep typing</button><CelebrationHost /></>);
    screen.getByRole("button", { name: "Keep typing" }).focus();
    act(() => celebrationQueue.enqueue([card("Achievement: First take")]));
    await screen.findByText("Achievement: First take", {}, { timeout: 3000 });
    expect(screen.getByRole("button", { name: "Keep typing" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Achievement: First take")).not.toBeInTheDocument());
  });

  it("describes the task, never the person, and keeps starting points silent", () => {
    const items = celebrationsFrom(
      {
        levels: [{ area: "fluency", level: 2, definitionVersion: 1, evidence: {}, achievedAt: "2026-10-16T08:00:00.000Z" }],
        achievements: [{ id: "no-notes", definitionVersion: 1, evidence: {}, unlockedAt: "x" }],
        records: [
          { id: 1, record: "longest_run", value: 11, unit: "words", previous: null, attemptId: null, sessionId: null, definitionVersion: 1, achievedAt: "x" },
          { id: 2, record: "fewest_confirmed_per_100_unfamiliar", value: 2.5, unit: "per 100 words", previous: 3, attemptId: null, sessionId: null, definitionVersion: 1, achievedAt: "x" },
        ],
        questsDone: [], weeklyGoal: "2026-10-12", xp: 0,
      },
      { goal: { days: 3, goal: 3, weeksInARow: 2 } },
    );
    expect(items.map((c) => [c.kind, c.headline, c.quiet])).toEqual([
      ["level", "Fluency · level 2 · Replacing", false],
      ["weeklyGoal", "Weekly goal reached", false],
      ["achievement", "Achievement: Said it without notes", false],
      ["record", "New best: fewest confirmed hesitations, unfamiliar topic, 2.5 per 100 words", true],
    ]);
    expect(items[1].because).toBe("3 of 3 days. That's 2 weeks in a row.");
    for (const c of items) expect(`${c.headline} ${c.because ?? ""}`).not.toMatch(/\b(you'?re|perfect|natural|fluent|great job)\b/i);
  });
});
