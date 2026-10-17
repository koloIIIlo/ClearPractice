import { describe, expect, it } from "vitest";
import { offending } from "@/test/no-scores";
import { routes } from "@/app/routes";
import type { Criterion } from "./criteria";
import { AREAS, available, LEVELS } from "./skills";
import { AREA_IDS } from "./types";

function* all(c: Criterion): Generator<Criterion> {
  yield c;
  if (c.kind === "anyOf") for (const o of c.options) yield* all(o);
  if (c.kind === "allOf") for (const p of c.parts) yield* all(p);
}
const needed = (c: Criterion) => ("atLeast" in c ? c.atLeast : c.kind === "phrases" ? (c.saved ?? c.reviews ?? 1) : c.kind === "phraseUses" ? (c.takes ?? c.distinctPhrases ?? 1) : c.kind === "exposure" ? c.steps : 1);

/** Top-level route paths, so practise links point somewhere real. */
const paths = new Set<string>(["/"]);
const walk = (list: typeof routes, base = "") => {
  for (const r of list) {
    const path = r.path ? `${base}/${r.path}`.replace(/\/+/g, "/") : base;
    if (r.path) paths.add(path.split("/:")[0]);
    if (r.children) walk(r.children as typeof routes, path);
  }
};
walk(routes);

describe("level definitions (appendix A)", () => {
  it("has five levels in each of the eight areas with unique names", () => {
    expect(AREAS.map((a) => a.id)).toEqual([...AREA_IDS]);
    for (const area of AREA_IDS) {
      expect(LEVELS[area].map((l) => l.level), area).toEqual([1, 2, 3, 4, 5]);
      expect(new Set(LEVELS[area].map((l) => l.name)).size, area).toBe(5);
    }
  });

  it("labels every criterion, needs at least one of anything and uses no score words", () => {
    for (const area of AREA_IDS)
      for (const level of LEVELS[area]) {
        expect(offending(`${level.name}. ${level.description}`)).toEqual([]);
        for (const c of level.criteria.flatMap((x) => [...all(x)])) {
          expect(c.label.length, `${area} ${level.level}`).toBeGreaterThan(0);
          expect(needed(c), `${area} ${level.level} ${c.label}`).toBeGreaterThanOrEqual(1);
          expect(offending(c.label)).toEqual([]);
        }
      }
  });

  it("points every available practise link to an existing route", () => {
    for (const area of AREA_IDS)
      for (const level of LEVELS[area])
        for (const link of level.practise.filter(available)) {
          const path = link.to.split("?")[0];
          expect(paths.has(path) || paths.has(path.split("/").slice(0, 2).join("/")), `${area} ${level.level}: ${link.to}`).toBe(true);
        }
  });

  it("never makes a higher level easier on the same counted dimension", () => {
    for (const area of AREA_IDS) {
      const levels = LEVELS[area];
      for (let i = 1; i < levels.length; i += 1) {
        const [prev, next] = [levels[i - 1].criteria[0], levels[i].criteria[0]];
        if (prev.kind === next.kind && "filter" in prev && "filter" in next && JSON.stringify(prev.filter) === JSON.stringify(next.filter)) {
          expect(needed(next), `${area} ${i + 1}`).toBeGreaterThanOrEqual(needed(prev));
        }
      }
    }
  });
});
