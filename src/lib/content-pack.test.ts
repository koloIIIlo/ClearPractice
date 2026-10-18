import { expect, it } from "vitest";
import { ContentPack, MAX_PACK_BYTES, packCounts, prefixContentPack, validateContentPack } from "./content-pack";
import { PROMPTS } from "@/content/prompts";
import { SCENARIOS } from "@/content/scenarios";
import { MISSIONS } from "@/content/missions";
import { jamTopics, missions, packPrompts, rouletteTopics, scenarios, setRuntimePacks } from "./content-runtime";

const sample = () => ({ format: "clearpractice-content-pack", version: 1, id: "example", title: "Example pack", prompts: [PROMPTS[0]], drillTopics: { jam: [{ id: "jam-extra", text: "A small shop" }], roulette: { work: [{ id: "roulette-extra", text: "A useful meeting" }] } }, scenarios: [SCENARIOS[0]], missions: [MISSIONS[0]] });
it("validates and prefixes pack items", () => {
  const pack = prefixContentPack(validateContentPack(JSON.stringify(sample())));
  expect(pack.prompts[0].id).toBe(`pack-example--${PROMPTS[0].id}`);
  expect(pack.scenarios[0].id).toBe(`pack-example--${SCENARIOS[0].id}`);
  expect(pack.missions[0].id).toBe(`pack-example--${MISSIONS[0].id}`);
  expect(pack.drillTopics.jam?.[0].id).toBe("pack-example--jam-extra");
  expect(pack.drillTopics.roulette?.work?.[0].id).toBe("pack-example--roulette-extra");
  expect(packCounts(pack)).toEqual({ prompts: 1, drillTopics: 2, scenarios: 1, missions: 1 });
  setRuntimePacks([pack]);
  const snapshot = structuredClone(pack.prompts[0]);
  expect(packPrompts()).toHaveLength(1);
  expect(jamTopics([])).toHaveLength(1);
  expect(rouletteTopics([], "work")).toHaveLength(1);
  expect(scenarios([])).toHaveLength(1);
  expect(missions([])).toHaveLength(1);
  setRuntimePacks([]);
  expect(packPrompts()).toEqual([]);
  expect(jamTopics([])).toEqual([]);
  expect(scenarios([])).toEqual([]);
  expect(missions([])).toEqual([]);
  expect(snapshot.text).toBe(PROMPTS[0].text);
});
it("refuses unknown fields and oversize packs", () => {
  const pack = sample();
  const bad = [
    { ...pack, surprise: true },
    { ...pack, prompts: [{ ...PROMPTS[0], surprise: true }] },
    { ...pack, prompts: [{ ...PROMPTS[0], conditions: { ...PROMPTS[0].conditions, surprise: true } }] },
    { ...pack, drillTopics: { mystery: [] } },
    { ...pack, drillTopics: { roulette: { unknown: [] } } },
    { ...pack, scenarios: [{ ...SCENARIOS[0], surprise: true }] },
    { ...pack, missions: [{ ...MISSIONS[0], surprise: true }] },
    { ...pack, prompts: [PROMPTS[0], PROMPTS[0]] },
    { ...pack, id: "../escape" }, { ...pack, version: 2 },
  ];
  for (const value of bad) expect(() => validateContentPack(JSON.stringify(value))).toThrow();
  expect(() => validateContentPack(" ".repeat(MAX_PACK_BYTES) + JSON.stringify(pack))).toThrow(/1 MB/);
  expect(() => validateContentPack("\u00e9".repeat(MAX_PACK_BYTES / 2 + 1))).toThrow(/1 MB/);
  expect(ContentPack.safeParse(pack).success).toBe(true);
});
