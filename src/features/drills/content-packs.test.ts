import { expect, it } from "vitest";
import { prefixContentPack, validateContentPack } from "@/lib/content-pack";
import { setRuntimePacks } from "@/lib/content-runtime";
import { plan as jam } from "./modules/jam";
import { plan as roulette } from "./modules/roulette";

it("plans drill rounds from imported topics and keeps the planned wording after removal", () => {
  const pack = prefixContentPack(validateContentPack(JSON.stringify({ format: "clearpractice-content-pack", version: 1, id: "drills", title: "Extra drills", prompts: [], drillTopics: { jam: [{ id: "one", text: "A village shop" }], roulette: { work: [{ id: "two", text: "A shared workspace" }] } }, scenarios: [], missions: [] })));
  setRuntimePacks([pack]);
  const first = jam("test", { topic: "pack-drills--one" });
  const second = roulette("test", { category: "work", topic: "pack-drills--two" });
  expect(first.rounds[0].prompt).toBe("A village shop");
  expect(second.rounds[0].prompt).toBe("A shared workspace");
  setRuntimePacks([]);
  expect(first.rounds[0].prompt).toBe("A village shop");
  expect(jam("test", { topic: "pack-drills--one" }).contentId).not.toBe("pack-drills--one");
});
