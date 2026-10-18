import type { ContentPack } from "./content-pack";
import type { Topic } from "@/content/jam-topics";
import type { RouletteCategory } from "@/content/roulette-topics";
import type { Scenario } from "@/content/scenarios";
import type { Mission } from "@/content/missions";

// Populated only by the IPC clients, after strict validation. Bundled arrays stay immutable.
let packs: ContentPack[] = [];
export const setRuntimePacks = (next: ContentPack[]) => { packs = next; };
export const packPrompts = () => packs.flatMap((p) => p.prompts);
export const jamTopics = (bundled: readonly Topic[]) => [...bundled, ...packs.flatMap((p) => p.drillTopics.jam ?? [])];
export const rouletteTopics = (bundled: readonly Topic[], category: RouletteCategory) => [...bundled, ...packs.flatMap((p) => p.drillTopics.roulette?.[category] ?? [])];
export const scenarios = (bundled: readonly Scenario[]) => [...bundled, ...packs.flatMap((p) => p.scenarios)];
export const missions = (bundled: readonly Mission[]) => [...bundled, ...packs.flatMap((p) => p.missions)];
