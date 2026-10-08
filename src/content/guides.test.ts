import { expect, it } from "vitest";
import { Guide } from "@/lib/ipc/schemas";
import { GUIDES } from "./guides";

it("bundles 8 offline guides with full text and honest wording (4.3)", () => {
  expect(GUIDES).toHaveLength(8);
  expect(new Set(GUIDES.map((g) => g.id)).size).toBe(8);
  for (const g of GUIDES) {
    expect(() => Guide.parse(g), g.id).not.toThrow();
    const words = g.sections.flatMap((s) => s.paragraphs).join(" ").split(/\s+/).length;
    // Reading time stated on the card is plausible at ~100–200 words a minute for careful reading.
    expect(words, g.id).toBeGreaterThanOrEqual(100);
    expect(words / g.minutes, g.id).toBeLessThanOrEqual(200);
    const text = JSON.stringify(g).toLowerCase();
    expect(text, g.id).not.toMatch(/\byour score\b|\bcefr\b|\bfluency level\b/);
  }
  // The guide about limits says plainly what the app cannot judge.
  const limits = GUIDES.find((g) => g.id === "g-limits")!;
  expect(JSON.stringify(limits)).toMatch(/no pronunciation grade/);
});
