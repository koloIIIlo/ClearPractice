import { describe, expect, it } from "vitest";
import { ACCENTS, unlockedAccents } from "@/lib/engagement/accents";

/** Relative luminance and contrast (WCAG 2.x). */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
// Read from disk: Vitest hands CSS imports back empty, ?raw included.
const fs = (await import(/* @vite-ignore */ "node:fs" as string)) as { readFileSync(p: string, e: string): string };
const css = fs.readFileSync("src/index.css", "utf8");
const token = (block: string, name: string) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(block)?.[1];
const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css)![1];
const darkBlock = /\n\.dark\s*\{([\s\S]*?)\n\}/.exec(css)![1];

describe("accent colours (9.12)", () => {
  it("every accent keeps text contrast of at least 4.5:1 in light and dark", () => {
    const surfaces = { light: [token(rootBlock, "cp-surface")!, token(rootBlock, "cp-app-bg")!], dark: [token(darkBlock, "cp-surface")!, token(darkBlock, "cp-app-bg")!] };
    for (const accent of ACCENTS) {
      const light = new RegExp(`^\\[data-accent="${accent.id}"\\]\\s*\\{([^}]*)\\}`, "m").exec(css)?.[1];
      const dark = new RegExp(`\\.dark\\[data-accent="${accent.id}"\\][^{]*\\{([^}]*)\\}`).exec(css)?.[1];
      expect(light, accent.id).toBeTruthy();
      expect(dark, accent.id).toBeTruthy();
      for (const [mode, block] of [["light", light!], ["dark", dark!]] as const) {
        const fill = token(block, "cp-accent")!;
        const onFill = token(block, "cp-on-accent")!;
        // Text on the accent (buttons) and the accent as text (links) on the page's surfaces.
        expect(contrast(fill, onFill), `${accent.id} ${mode} button`).toBeGreaterThanOrEqual(4.5);
        for (const surface of surfaces[mode]) expect(contrast(fill, surface), `${accent.id} ${mode} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("locked accents cannot be chosen", () => {
    expect([...unlockedAccents(undefined)]).toEqual(["green"]);
    const state = { achievements: [{ id: "days-10", definitionVersion: 1, evidence: {}, unlockedAt: "x" }], levels: [] };
    expect(unlockedAccents(state).has("amber")).toBe(true);
    expect(unlockedAccents(state).has("rose")).toBe(false);
  });
});
