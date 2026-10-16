import { describe, expect, it } from "vitest";
import vectors from "./fixtures/word-vectors.json";
import { countHedges, countSequences, countWatchWords, tokens, WATCH_WORDS } from "./words";

const asMap = (counts: { word: string; count: number }[]) => Object.fromEntries(counts.map((c) => [c.word, c.count]));

describe("words you use often", () => {
  it.each(vectors.cases)("matches the shared vector: $name", (vector) => {
    expect(asMap(countWatchWords(vector.text, vector.extra))).toEqual(vector.watchWords);
    expect(asMap(countHedges(vector.text))).toEqual(vector.hedges);
  });

  it("counts whole-word sequences only and the longest item first", () => {
    const words = tokens("I meant it. I mean, you know, a little bit, so yeah. So yeah!");
    expect(countSequences(words, WATCH_WORDS).map((c) => [c.word, c.count])).toEqual([["so yeah", 2], ["you know", 1], ["i mean", 1]]);
  });

  it("lists the segments where a word was heard", () => {
    const counts = countWatchWords(["Actually it works.", "It does.", "Actually, actually."], ["works"]);
    expect(counts).toEqual([
      { word: "actually", count: 3, segments: [0, 2] },
      { word: "works", count: 1, segments: [0] },
    ]);
  });

  it("ignores your own words that are already in the default list", () => {
    expect(countWatchWords("Actually yes", ["Actually"])).toEqual([{ word: "actually", count: 1, segments: [0] }]);
  });
});
