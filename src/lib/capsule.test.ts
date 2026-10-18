import { describe, expect, it } from "vitest";
import { PROMPTS } from "@/content/prompts";
import { factsBuilder } from "@/test/fixtures/facts";
import { capsuleMonths, capsulePrompt, capsuleShows } from "./capsule";

describe("the time capsule (14.5)", () => {
  it("offers the capsule in the first week of a month once", () => {
    const month = { offeredOn: "2026-11-03", dismissed: false };
    // From the first app day of the month, for seven days.
    expect(["2026-11-03", "2026-11-06", "2026-11-09"].map((d) => capsuleShows(month, d, false))).toEqual([true, true, true]);
    expect(capsuleShows(month, "2026-11-10", false)).toBe(false);
    expect(capsuleShows(month, "2026-12-01", false), "a new month starts its own offer").toBe(false);
    expect(capsuleShows(month, "2026-11-04", true), "not again once done").toBe(false);
    expect(capsuleShows({ ...month, dismissed: true }, "2026-11-04", false), "nor once dismissed").toBe(false);
  });

  it("uses the baseline prompt or the first prompt answered", () => {
    const first = factsBuilder().onDay(30).session({ contentId: PROMPTS[3].id }).take().onDay(10).session({ contentId: PROMPTS[0].id }).take().build();
    expect(capsulePrompt(first, PROMPTS)).toMatchObject({ promptId: PROMPTS[3].id, text: PROMPTS[3].text, firstTake: { id: "take-2" } });
    const withBaseline = factsBuilder().onDay(30).session({ contentId: PROMPTS[3].id }).take().onDay(20).session({ contentId: "baseline", tags: ["baseline"] }).take().take().build();
    expect(capsulePrompt(withBaseline, PROMPTS)).toMatchObject({ promptId: "baseline", firstTake: { id: "take-4" } });
    // A drill, a conversation or a capsule isn't a first prompt; nothing answered gives none.
    expect(capsulePrompt(factsBuilder().session({ exerciseType: "jam", contentId: null }).take().build(), PROMPTS)).toBeNull();
  });

  it("lists one capsule a month", () => {
    const facts = factsBuilder("2026-12-10")
      .onDay(60).session({ exerciseType: "capsule" }).take()
      .onDay(58).session({ exerciseType: "capsule" }).take()
      .onDay(5).session({ exerciseType: "capsule" }).take()
      .build();
    expect(capsuleMonths(facts).map((c) => [c.month, c.take.id])).toEqual([["2026-10", "take-2"], ["2026-12", "take-6"]]);
  });
});
