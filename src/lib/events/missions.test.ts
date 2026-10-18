import { describe, expect, it } from "vitest";
import { MISSIONS, missionById } from "@/content/missions";
import { duplicates, ID_PATTERN, LIMITS, tooLong } from "@/content/content-checks";
import { AREA_IDS } from "@/lib/engagement/types";
import { offending } from "@/test/no-scores";
import { factsBuilder } from "@/test/fixtures/facts";
import { missionOffers, recentMissions } from "./missions";

describe("missions (14.1)", () => {
  it("offers one mission per difficulty, leaning toward the weakest area", () => {
    const offers = missionOffers("2026-10-12", "storytelling");
    expect(offers.map((m) => m.difficulty)).toEqual([1, 2, 3]);
    expect(offers.filter((m) => m.area === "storytelling").length).toBeGreaterThanOrEqual(1);
    expect(missionOffers("2026-10-12", "storytelling"), "the same for the whole week").toEqual(offers);
    // Every week leans the same way; without a lean the area turns up less often.
    const weeks = Array.from({ length: 30 }, (_, i) => `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`);
    const leaning = weeks.filter((w) => missionOffers(w, "storytelling").some((m) => m.area === "storytelling")).length;
    const plain = weeks.filter((w) => missionOffers(w, null).some((m) => m.area === "storytelling")).length;
    expect(leaning).toBe(weeks.length);
    expect(plain).toBeLessThan(leaning);
    // An area with only easy missions leans on that difficulty.
    expect(missionOffers("2026-10-12", "voice").map((m) => m.id)).toContain("voice-message");
  });

  it("Choose another shows three you haven't been offered this week, and recent missions wait", () => {
    const first = missionOffers("2026-10-12", "courage");
    const second = missionOffers("2026-10-12", "courage", 1);
    expect(second.map((m) => m.difficulty)).toEqual([1, 2, 3]);
    expect(second.filter((m) => first.some((f) => f.id === m.id))).toEqual([]);
    const third = missionOffers("2026-10-12", "courage", 2);
    expect(third.filter((m) => [...first, ...second].some((f) => f.id === m.id))).toEqual([]);
    const avoid = MISSIONS.filter((m) => m.difficulty === 1 && m.id !== "thank-specifically").map((m) => m.id);
    expect(missionOffers("2026-10-12", null, 0, avoid)[0].id).toBe("thank-specifically");
    const facts = factsBuilder("2026-10-14")
      .missionPick({ week: "2026-10-05", missionId: "dinner-story", done: true })
      .missionPick({ week: "2026-09-28", missionId: "speak-first", done: false })
      .missionPick({ week: "2026-06-01", missionId: "run-meeting", done: true })
      .build();
    expect(recentMissions(facts, "2026-10-12")).toEqual(["dinner-story"]);
  });

  it("has 40 missions with unique IDs, every area and difficulty, and plain wording", () => {
    expect(MISSIONS).toHaveLength(40);
    expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(40);
    for (const m of MISSIONS) expect(m.id).toMatch(ID_PATTERN);
    for (const area of AREA_IDS) expect(MISSIONS.some((m) => m.area === area), area).toBe(true);
    for (const d of [1, 2, 3]) expect(MISSIONS.filter((m) => m.difficulty === d).length).toBeGreaterThanOrEqual(10);
    expect(duplicates(MISSIONS.map((m) => m.title))).toEqual([]);
    expect(tooLong(MISSIONS.map((m) => m.title), LIMITS.prompt)).toEqual([]);
    expect(tooLong(MISSIONS.map((m) => m.how), LIMITS.instruction)).toEqual([]);
    expect(MISSIONS.flatMap((m) => offending(`${m.title}. ${m.how}`))).toEqual([]);
    expect(MISSIONS.every((m) => m.tags.length > 0)).toBe(true);
    // Appendix A's storytelling level 5 points at this one.
    expect(missionById("dinner-story")?.title).toBe("Tell a one-minute story at dinner");
  });
});
