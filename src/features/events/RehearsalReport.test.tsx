import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RehearsalReport as Report } from "@/lib/ipc/schemas";
import { expectNoScores } from "@/test/no-scores";
import { difference, RehearsalReport } from "./RehearsalReport";

const report = (transcribed: boolean): Report => ({
  attemptId: "take-1", talkId: "talk-1", sessionId: "session-1", localDate: "2026-10-18", createdAt: "2026-10-18T10:00:00.000Z",
  totalTargetSeconds: 300, totalActualMs: 318_000, note: null, transcribed,
  sections: [
    { sectionId: "a", title: "Opening", targetSeconds: 30, reached: true, actualMs: 41_000, words: transcribed ? 88 : null, paceWpm: transcribed ? 128.4 : null, hesitations: transcribed ? 1 : null },
    { sectionId: "b", title: "What we built", targetSeconds: 90, reached: true, actualMs: 82_000, words: transcribed ? 170 : null, paceWpm: transcribed ? 124 : null, hesitations: transcribed ? 0 : null },
    { sectionId: "c", title: "How it works", targetSeconds: 90, reached: true, actualMs: 90_000, words: transcribed ? 180 : null, paceWpm: transcribed ? 120 : null, hesitations: transcribed ? 2 : null },
    { sectionId: "d", title: "Close", targetSeconds: 90, reached: true, actualMs: 105_000, words: transcribed ? 200 : null, paceWpm: transcribed ? 114 : null, hesitations: transcribed ? 0 : null },
    { sectionId: "e", title: "Questions", targetSeconds: 5, reached: false, actualMs: 0, words: transcribed ? 0 : null, paceWpm: null, hesitations: transcribed ? 0 : null },
  ],
});

const rowOf = (title: string) => screen.getByRole("rowheader", { name: new RegExp(title) }).closest("tr")!;

describe("the rehearsal report (14.3)", () => {
  it("shows over and under as times without judgement", () => {
    const { container } = render(<RehearsalReport report={report(true)} />);
    const cells = (title: string) => within(rowOf(title)).getAllByRole("cell").map((c) => c.textContent);
    expect(cells("Opening")).toEqual(["0:30", "0:41", "+0:11", "88", "128 wpm", "1"]);
    expect(cells("What we built")).toEqual(["1:30", "1:22", "−0:08", "170", "124 wpm", "0"]);
    expect(cells("How it works")[2]).toBe("0:00");
    expect(cells("Questions")).toEqual(["0:05", "Not reached", "", "–", "–", "–"]);
    expect(within(screen.getByRole("rowheader", { name: "Total" }).closest("tr")!).getAllByRole("cell").map((c) => c.textContent).slice(0, 3)).toEqual(["5:00", "5:18", "+0:18"]);
    // Over and under carry no colour and no verdict.
    for (const cell of container.querySelectorAll("td")) expect(cell.className).not.toMatch(/destructive|primary|green|red|amber|warning/);
    expect(container.textContent).not.toMatch(/too (long|short)|good|bad/i);
    expect(screen.getByText("Estimated")).toBeInTheDocument();
    expectNoScores(container);
  });

  it("says how to get words and pace before the take is transcribed", () => {
    const { container } = render(<RehearsalReport report={{ ...report(false), note: "No section marks were saved, so the whole take counts as section 1." }} />);
    expect(within(rowOf("Opening")).getAllByRole("cell").map((c) => c.textContent).slice(3)).toEqual(["–", "–", "–"]);
    expect(screen.getByText(/Transcribe the take to see words, pace and hesitation candidates/)).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("No section marks were saved");
    expectNoScores(container);
  });

  it("formats differences with a sign, as times", () => {
    expect([difference(41_000, 30), difference(82_000, 90), difference(60_400, 60), difference(3_725_000, 60)]).toEqual(["+0:11", "−0:08", "0:00", "+61:05"]);
  });
});
