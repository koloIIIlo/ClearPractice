import { expect, it } from "vitest";
import { factsBuilder } from "./facts";

it("builds facts that pass the schema", () => {
  const facts = factsBuilder().session({ familiarity: "unfamiliar" }).take().take({ transcribed: true, words: 120 }).transfer().phrase().phraseReview().build();
  expect(facts.sessions).toHaveLength(1);
  expect(facts.takes.map((t) => t.ordinal)).toEqual([1, 2]);
  expect(facts.sessions[0]).toMatchObject({ takeCount: 2, durationMs: 120_000, familiarity: "unfamiliar" });
  expect(facts.phraseReviews[0].cardId).toBe(facts.phrases[0].id);
});

it("places items on the requested days", () => {
  const facts = factsBuilder("2026-10-12").onDay(3).session().take().onDay(0).session().take().transfer().build();
  expect(facts.sessions.map((s) => s.localDate)).toEqual(["2026-10-09", "2026-10-12"]);
  expect(facts.takes.map((t) => t.localDate)).toEqual(["2026-10-09", "2026-10-12"]);
  expect(facts.transferReviews[0].localDate).toBe("2026-10-12");
});

it("adds a session when a take comes first", () => {
  const facts = factsBuilder().take().build();
  expect(facts.takes[0].sessionId).toBe(facts.sessions[0].id);
});
