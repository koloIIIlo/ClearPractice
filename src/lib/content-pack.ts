import { setRuntimePacks } from "./content-runtime";
import { z } from "zod";
import { PracticePrompt, PromptTag, TaskConditions, TransferTag } from "./ipc/schemas";

export const MAX_PACK_BYTES = 1_000_000;
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const text = (max: number) => z.string().trim().min(1).max(max).refine((s) => !s.includes("\0"));
const area = z.enum(["structure", "fluency", "voice", "spontaneity", "vocabulary", "listening", "storytelling", "courage"]);
const topic = z.object({ id, text: text(80) }).strict();
const prompt = PracticePrompt.extend({ id, text: text(160), tags: z.array(PromptTag).min(1), conditions: TaskConditions.extend({ preparationSeconds: z.number().int().min(0).max(3600), targetSeconds: z.number().int().min(1).max(3600), audience: text(200).nullable() }).strict() }).strict();
const scenario = z.object({
  id, title: text(160), summary: text(200), area, partnerRole: text(200), learnerGoal: text(200), opening: text(200),
  maxTurns: z.number().int().min(4).max(12), scripted: z.array(text(200)).min(6).max(30),
  defaultPersona: z.enum(["friendly", "neutral", "skeptic", "newcomer", "expert", "interviewer"]),
  recommendedAfter: z.object({ area, level: z.number().int().min(1).max(5) }).strict().optional(),
}).strict();
const mission = z.object({ id, title: text(160), how: text(200), area, difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]), tags: z.array(TransferTag).min(1) }).strict();
export const ContentPack = z.object({
  format: z.literal("clearpractice-content-pack"), version: z.literal(1), id: z.string().max(24).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), title: text(120),
  prompts: z.array(prompt).max(1000),
  drillTopics: z.object({
    jam: z.array(topic).max(1000).optional(),
    roulette: z.object({ daily_life: z.array(topic).optional(), work: z.array(topic).optional(), opinions: z.array(topic).optional(), storytelling: z.array(topic).optional(), unexpected: z.array(topic).optional(), explanations: z.array(topic).optional(), hypotheticals: z.array(topic).optional(), memories: z.array(topic).optional() }).strict().optional(),
  }).strict(),
  scenarios: z.array(scenario).max(1000), missions: z.array(mission).max(1000),
}).strict().superRefine((pack, ctx) => {
  const lists = [pack.prompts, pack.scenarios, pack.missions, pack.drillTopics.jam ?? [], ...Object.values(pack.drillTopics.roulette ?? {})];
  // IDs must be unique throughout a pack, including all drill categories.
  const ids = lists.flatMap((list) => list.map((item) => item.id));
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Pack item IDs must be unique." });
});
export type ContentPack = z.infer<typeof ContentPack>;
export const StoredContentPack = z.object({ json: z.string(), importedAtMs: z.number().int().nonnegative() }).strict();
export type StoredContentPack = z.infer<typeof StoredContentPack>;

/** Size is checked on the original UTF-8 text, before parsing or normalising it. */
export function validateContentPack(json: string): ContentPack {
  if (new TextEncoder().encode(json).length > MAX_PACK_BYTES) throw new Error("Content packs must be at most 1 MB.");
  return ContentPack.parse(JSON.parse(json));
}
export function prefixContentPack(pack: ContentPack): ContentPack {
  const prefix = <T extends { id: string }>(items: T[]): T[] => items.map((item) => ({ ...item, id: `pack-${pack.id}--${item.id}` }));
  return { ...pack, prompts: prefix(pack.prompts).map((p) => ({ ...p, source: "bundled", favorite: false })), scenarios: prefix(pack.scenarios), missions: prefix(pack.missions), drillTopics: {
    ...(pack.drillTopics.jam ? { jam: prefix(pack.drillTopics.jam) } : {}),
    ...(pack.drillTopics.roulette ? { roulette: Object.fromEntries(Object.entries(pack.drillTopics.roulette).map(([k, list]) => [k, prefix(list)])) } : {}),
  } };
}
export function packCounts(pack: ContentPack) {
  return { prompts: pack.prompts.length, drillTopics: (pack.drillTopics.jam?.length ?? 0) + Object.values(pack.drillTopics.roulette ?? {}).reduce((n, list) => n + list.length, 0), scenarios: pack.scenarios.length, missions: pack.missions.length };
}
// TODO M16.3: optional imitation speech download after recordings and licences are verified.

export function registerContentPacks(rows: StoredContentPack[]) {
  setRuntimePacks(rows.map((row) => prefixContentPack(validateContentPack(row.json))));
  return rows;
}
