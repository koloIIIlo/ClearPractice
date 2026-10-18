import { expect, it } from "vitest";
import { offending } from "@/test/no-scores";
import { duplicates, ID_PATTERN, LIMITS, tooLong } from "./content-checks";
import { DEBATE_FOLLOW_UPS, DEBATE_PROMPTS, EVERYDAY_PROMPTS, INTERVIEW_PROMPTS, STORYTELLING_PROMPTS } from "./new-prompts";
import { PROMPTS } from "./prompts";
import { STAR_QUESTIONS } from "./star-questions";

for (const [title, list, count] of [["storytelling", STORYTELLING_PROMPTS, 30], ["everyday situations", EVERYDAY_PROMPTS, 40], ["debates", DEBATE_PROMPTS, 20]] as const) {
  it(`bundles ${count} unique ${title} prompts within the content rules`, () => {
    expect(list).toHaveLength(count);
    expect(new Set(list.map((p) => p.id)).size).toBe(count);
    expect(duplicates(list.map((p) => p.text))).toEqual([]);
    expect(tooLong(list.map((p) => p.text), LIMITS.prompt)).toEqual([]);
    expect(list.flatMap((p) => offending(p.text))).toEqual([]);
    for (const p of list) { expect(p.id).toMatch(ID_PATTERN); expect(PROMPTS).toContain(p); }
  });
}
it("reuses the thirty STAR questions and gives each debate a follow-up", () => {
  expect(INTERVIEW_PROMPTS.map((p) => ({ id: p.id, text: p.text }))).toEqual(STAR_QUESTIONS);
  expect(INTERVIEW_PROMPTS).toHaveLength(30);
  for (const p of DEBATE_PROMPTS) {
    expect(p.conditions.followUp).toBe(true);
    expect(p.text.match(/\?/g)).toHaveLength(1);
    // Two written follow-ups each, shown after the first take (5.11), with the same wording checks.
    expect(DEBATE_FOLLOW_UPS[p.id]).toHaveLength(2);
    for (const q of DEBATE_FOLLOW_UPS[p.id]) expect(offending(q), q).toEqual([]);
  }
});
