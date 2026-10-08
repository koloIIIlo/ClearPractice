import { expect, it } from "vitest";
import { PASSAGES, thoughtGroups, wordCount } from "./passages";

it("bundles 12 thought-group passages of 40–80 words with pause marks (4.2)", () => {
  expect(PASSAGES).toHaveLength(12);
  expect(new Set(PASSAGES.map((p) => p.id)).size).toBe(12);
  for (const p of PASSAGES) {
    const words = wordCount(p.text);
    expect(words, `${p.id} has ${words} words`).toBeGreaterThanOrEqual(40);
    expect(words, `${p.id} has ${words} words`).toBeLessThanOrEqual(80);
    const groups = thoughtGroups(p.text);
    expect(groups.length, p.id).toBeGreaterThanOrEqual(5);
    // A thought group carries one idea: short enough to say in one breath.
    expect(Math.max(...groups.map(wordCount)), p.id).toBeLessThanOrEqual(12);
  }
});

it("counts words without pause marks and splits groups in order", () => {
  expect(wordCount("One idea, / then another one.")).toBe(5);
  expect(thoughtGroups("One idea, / then another one.")).toEqual(["One idea,", "then another one."]);
});
