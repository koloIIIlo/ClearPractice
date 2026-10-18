import { describe, expect, it } from "vitest";
import { JAM_TOPICS } from "@/content/jam-topics";
import { PROMPTS } from "@/content/prompts";
import { ROULETTE_CATEGORIES, ROULETTE_TOPICS } from "@/content/roulette-topics";
import { DRILLS } from "@/content/drills";
import { DRILL_MODULES, type DrillParams } from "@/features/drills/drill-module";
import { newSeed } from "@/features/drills/plan-helpers";
import { challengeForPlan, challengeProblem, decodeChallenge, encodeChallenge } from "./codes";

const ctx = { prompts: PROMPTS, today: "2026-10-18" };
const seed = "7KX2M9QA";
const wrong = "That code doesn't look right. Check the last two characters.";
const newer = "This challenge needs a newer ClearPractice.";

// Build a future payload independently of the encoder's supported options.
function withCheck(body: string): string {
  let remainder = 0;
  for (const char of body) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      const top = (remainder >> 9) ^ ((char.charCodeAt(0) >> bit) & 1);
      remainder = ((remainder << 1) ^ (top ? 0x233 : 0)) & 1023;
    }
  }
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  return `${body}-${alphabet[remainder >> 5]}${alphabet[remainder & 31]}`;
}

describe("challenge codes (15.3)", () => {
  it("round-trips every drill with params", async () => {
    const cases: [string, DrillParams][] = [
      ["jam", { topic: JAM_TOPICS[9].id }],
      ["roulette", { category: "work", topic: ROULETTE_TOPICS.work[2].id, speak: 120, respun: true }],
      ["word-bomb", { prompt: "p-process" }],
      ["emphasis", {}],
      ["story-cubes", { cubes: 6, rerolled: true }],
      ["pitch", { prompt: "p-remote" }],
      ["gauntlet", {}],
    ];
    for (const [id, params] of cases) {
      const drill = DRILLS.find((d) => d.id === id)!;
      const module = await DRILL_MODULES[drill.type]();
      const played = module.plan(seed, params, ctx);
      const code = await challengeForPlan(played, ctx);
      expect(code, id).not.toBeNull();
      expect(challengeProblem(code!)).toBeNull();
      const decoded = decodeChallenge(code!)!;
      expect(decoded).toMatchObject({ drillId: id, seed });
      const replay = module.plan(decoded.seed, decoded.params, ctx);
      expect(replay.sessionPrompt).toBe(played.sessionPrompt);
      expect(replay.params).toEqual(played.params);
      expect(replay.rounds).toEqual(played.rounds);
      expect(decodeChallenge(code!.toLowerCase().replace(/-/g, " - "))).toEqual(decoded);
      const input = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, typeof value === "boolean" ? String(value) : value])) as Record<string, string | number>;
      expect(decodeChallenge(encodeChallenge(id, seed, input))?.params).toEqual(input);
    }
    const roulette = await DRILL_MODULES.roulette();
    for (const category of ROULETTE_CATEGORIES) {
      for (const speak of [30, 60, 90, 120]) {
        const played = roulette.plan(seed, { category: category.id, speak, respun: "false" }, ctx);
        const code = (await challengeForPlan(played, ctx))!;
        const decoded = decodeChallenge(code)!;
        expect(roulette.plan(decoded.seed, decoded.params, ctx).params).toEqual(played.params);
      }
    }
    const cubes = await DRILL_MODULES.story_cubes();
    for (const count of [3, 4, 5, 6]) {
      const played = cubes.plan(seed, { cubes: count, rerolled: "false" }, ctx);
      expect(await challengeForPlan(played, ctx)).not.toBeNull();
    }
    const pitch = await DRILL_MODULES.pitch();
    expect(await challengeForPlan(pitch.plan(seed, { idea: "My own idea" }, ctx), ctx)).toBeNull();
    const jam = await DRILL_MODULES.jam();
    const played = jam.plan(seed, {}, ctx);
    expect(await challengeForPlan({ ...played, sessionPrompt: "A changed topic" }, ctx)).toBeNull();
    expect(await challengeForPlan({ ...played, params: { ...played.params, extra: 1 } }, ctx)).toBeNull();
    expect(await challengeForPlan(jam.plan("old-seed", {}, ctx), ctx)).toBeNull();
    const gauntlet = await DRILL_MODULES.gauntlet();
    const subset = { ...ctx, prompts: [PROMPTS[0]] };
    expect(await challengeForPlan(gauntlet.plan(seed, {}, subset), subset)).toBeNull();
    const bomb = await DRILL_MODULES.word_bomb();
    const bombPlan = bomb.plan(seed, {}, ctx);
    expect(await challengeForPlan({ ...bombPlan, params: { ...bombPlan.params, words: ["changed"] } }, ctx)).toBeNull();
    const ambiguous = encodeChallenge("jam", "01010101");
    expect(decodeChallenge(ambiguous.replace("01010101", "oIoLoIoL"))?.seed).toBe("01010101");
    for (let i = 0; i < 20; i += 1) {
      const fresh = newSeed();
      expect(fresh).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(fresh).toMatch(/^[A-Za-z0-9-]{1,64}$/);
      expect(decodeChallenge(encodeChallenge("jam", fresh))?.seed).toBe(fresh);
    }
  }, 30_000);

  it("rejects typos via the check characters", () => {
    const code = encodeChallenge("roulette", seed, { category: "work", speak: 90, respun: "true" });
    for (let i = 0; i < code.length; i += 1) {
      if (code[i] === "-") continue;
      const typo = code.slice(0, i) + (code[i] === "0" ? "1" : "0") + code.slice(i + 1);
      expect(decodeChallenge(typo), typo).toBeNull();
      expect(challengeProblem(typo), typo).toBe(wrong);
    }
    for (const malformed of ["", "hello", code.slice(0, -1), `${code}-extra`, withCheck(`CP1-JAM-${seed}-T0T1`), withCheck(`CP1-JAM-${seed}-T`)]) {
      expect(decodeChallenge(malformed)).toBeNull();
      expect(challengeProblem(malformed)).toBe(wrong);
    }
    const original = encodeChallenge("jam", seed);
    expect(original).toBe(withCheck(`CP1-JAM-${seed}`));
    expect(() => encodeChallenge("pitch", seed, { idea: "Private idea" })).toThrow();
    expect(() => encodeChallenge("jam", "not-a-seed")).toThrow();
  });

  it("explains codes from a newer version", () => {
    for (const code of [
      encodeChallenge("jam", seed).replace("CP1-", "CP2-"),
      `CP10-JAM-${seed}-00`,
      `CP20-JAM-${seed}-00`,
      withCheck(`CP1-XYZ-${seed}`),
      withCheck(`CP1-JAM-${seed}-T99999`),
      withCheck(`CP1-PIT-${seed}-P99999`),
      withCheck(`CP1-ROU-${seed}-C99999`),
      withCheck(`CP1-JAM-${seed}-X1`),
    ]) {
      expect(decodeChallenge(code)).toBeNull();
      expect(challengeProblem(code)).toBe(newer);
    }
  });
});
