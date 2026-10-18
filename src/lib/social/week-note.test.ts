import { describe, expect, it } from "vitest";
import type { PracticeEvent } from "@/lib/ipc/schemas";
import { factsBuilder } from "@/test/fixtures/facts";
import { buildWeekNote } from "./week-note";

function event(localDate: string, kind = "take_saved"): PracticeEvent {
  return { id: 1, kind, refId: localDate, localDate, sessionId: null, attemptId: null, xp: 10, backfilled: false, createdAt: `${localDate}T12:00:00Z` };
}

describe("Copy my week (15.4)", () => {
  it("summarises the week from events and facts", () => {
    const builder = factsBuilder("2026-10-18")
      .onDay(6).session({ exerciseType: "jam" }).take({ result: { cleanSeconds: 45 } }).take({ result: { cleanSeconds: 52 } });
    for (const offset of [5, 3, 1]) builder.onDay(offset).session().take({ durationMs: 240_000 }).take({ durationMs: 240_000 }).take({ durationMs: 240_000 });
    const facts = builder.onDay(3).transfer()
      .onDay(7).session({ exerciseType: "jam" }).take({ durationMs: 600_000, result: { cleanSeconds: 60 } }).transfer()
      .onDay(-1).session().take().transfer().build();
    const events = [event("2026-10-12"), event("2026-10-12", "drill_round"), event("2026-10-13"), event("2026-10-15", "transfer_review"), event("2026-10-17"), event("2026-10-14", "session_finished"), event("2026-10-11"), event("2026-10-19")];
    expect(buildWeekNote(facts, events, "monday")).toBe(
      "My speaking practice this week: 4 days, 38 minutes, 11 takes.\nPlayed Just a Minute twice (best 52 clean seconds) and had 1 real conversation.",
    );
    const sunday = factsBuilder("2026-10-18").session({ exerciseType: "pitch" }).take().take().take().build();
    expect(buildWeekNote(sunday, [event("2026-10-17"), event("2026-10-18")], "sunday")).toBe(
      "My speaking practice this week: 1 day, 3 minutes, 3 takes.\nPlayed Elevator pitch once.",
    );
    expect(buildWeekNote(factsBuilder().build(), [], "monday")).toBe("No speaking practice recorded this week.");
    const missing = factsBuilder().session({ exerciseType: "jam" }).take().take({ result: { cleanSeconds: 0 } }).build();
    expect(buildWeekNote(missing, [], "monday")).toBe("My speaking practice this week: 2 minutes, 2 takes.\nPlayed Just a Minute twice.");
  });

  it("includes only the chosen highlight", () => {
    const facts = factsBuilder().session({ focus: "Private session notes", ease: 5 }).take({ words: 89, paceWpm: 150 }).transfer({ flow: "smooth", hasSuccess: true }).build();
    const highlight = "Explained my job to my neighbour without notes.";
    const plain = buildWeekNote(facts, [], "monday");
    expect(plain).not.toContain("Highlight:");
    expect(buildWeekNote(facts, [], "monday", `  ${highlight}  `)).toBe(`${plain}\nHighlight: "${highlight}"`);
    expect(buildWeekNote(facts, [], "monday", "   ")).toBe(plain);
    expect(plain).not.toMatch(/Private session notes|smooth|89|150|score|mood/i);
  });
});
