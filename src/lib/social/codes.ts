import { JAM_TOPICS } from "@/content/jam-topics";
import { PROMPTS } from "@/content/prompts";
import { ROULETTE_CATEGORIES, ROULETTE_TOPICS } from "@/content/roulette-topics";
import { DRILL_MODULES, type DrillPlan, type PlanContext } from "@/features/drills/drill-module";

const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const WRONG_CODE = "That code doesn't look right. Check the last two characters.";
const NEWER_APP = "This challenge needs a newer ClearPractice.";
type Params = Record<string, string | number>;
type Challenge = { drillId: string; seed: string; params: Params };
type Field = { key: string; letter: string; values: readonly (string | number)[] };

const field = (key: string, letter: string, values: Field["values"]): Field => ({ key, letter, values });
const topics = ROULETTE_CATEGORIES.flatMap((c) => ROULETTE_TOPICS[c.id]);
// CP1 fixes the content order and planning rules. Bump the code version if either changes.
const DRILLS: Record<string, { alias: string; fields: Field[] }> = {
  jam: { alias: "JAM", fields: [field("topic", "T", JAM_TOPICS.map((t) => t.id))] },
  roulette: {
    alias: "ROU",
    fields: [
      field("category", "C", ROULETTE_CATEGORIES.map((c) => c.id)),
      field("topic", "T", topics.map((t) => t.id)),
      field("speak", "S", [30, 60, 90, 120]),
      field("respun", "R", ["false", "true"]),
    ],
  },
  "word-bomb": { alias: "WBM", fields: [field("prompt", "P", PROMPTS.filter((p) => p.conditions.familiarity === "familiar").map((p) => p.id))] },
  emphasis: { alias: "EMP", fields: [] },
  "story-cubes": { alias: "STC", fields: [field("cubes", "C", [3, 4, 5, 6]), field("rerolled", "R", ["false", "true"])] },
  pitch: { alias: "PIT", fields: [field("prompt", "P", PROMPTS.filter((p) => p.tags.some((t) => t === "opinions" || t === "work" || t === "explanations")).map((p) => p.id))] },
  gauntlet: { alias: "GAU", fields: [] },
};

const base32Input = (s: string) => s.replace(/O/g, "0").replace(/[IL]/g, "1");

/** CRC-10/ATM over the ASCII body, including its separators and option pairs. */
function check(body: string): string {
  let crc = 0;
  for (const char of body) {
    crc ^= char.charCodeAt(0) << 2;
    for (let bit = 0; bit < 8; bit += 1) crc = ((crc << 1) ^ (crc & 0x200 ? 0x233 : 0)) & 0x3ff;
  }
  return BASE32[crc >> 5] + BASE32[crc & 31];
}

function optionsProblem(drillId: string, params: Params): string | null {
  if (drillId === "roulette" && params.category !== undefined && params.topic !== undefined) {
    const category = ROULETTE_CATEGORIES.find((c) => c.id === params.category);
    if (!category || !ROULETTE_TOPICS[category.id].some((t) => t.id === params.topic)) return WRONG_CODE;
  }
  return null;
}

/** CP1-<alias>-<eight Crockford characters>[-<letter/index pairs>]-<check>. */
export function encodeChallenge(drillId: string, seed: string, params: Params = {}): string {
  const drill = Object.hasOwn(DRILLS, drillId) ? DRILLS[drillId] : undefined;
  const canonicalSeed = base32Input(seed.toUpperCase().replace(/\s/g, ""));
  if (!drill || !/^[0-9A-HJKMNP-TV-Z]{8}$/.test(canonicalSeed)) throw new Error(WRONG_CODE);
  if (Object.keys(params).some((key) => !drill.fields.some((f) => f.key === key))) throw new Error(WRONG_CODE);
  const pairs = drill.fields.flatMap((f) => {
    if (params[f.key] === undefined) return [];
    const index = f.values.findIndex((v) => String(v) === String(params[f.key]));
    if (index < 0) throw new Error(NEWER_APP);
    return [`${f.letter}${index}`];
  }).join("");
  const problem = optionsProblem(drillId, params);
  if (problem) throw new Error(problem);
  const body = `CP1-${drill.alias}-${canonicalSeed}${pairs ? `-${pairs}` : ""}`;
  return `${body}-${check(body)}`;
}

function readChallenge(code: string): Challenge | string {
  const parts = code.toUpperCase().replace(/\s/g, "").split("-");
  parts[0] = base32Input(parts[0]);
  if (/^CP[2-9]\d*$/.test(parts[0]) || /^CP1\d+$/.test(parts[0])) return NEWER_APP;
  if (parts[0] !== "CP1" || (parts.length !== 4 && parts.length !== 5)) return WRONG_CODE;
  parts[2] = base32Input(parts[2]);
  parts[parts.length - 1] = base32Input(parts[parts.length - 1]);
  if (parts.length === 5) parts[3] = parts[3].replace(/([A-Z])([0-9OIL]+)/g, (_, letter: string, value: string) => letter + base32Input(value));
  if (!/^[A-Z]{3}$/.test(parts[1]) || !/^[0-9A-HJKMNP-TV-Z]{8}$/.test(parts[2]) || !/^[0-9A-HJKMNP-TV-Z]{2}$/.test(parts.at(-1)!)) return WRONG_CODE;
  const body = parts.slice(0, -1).join("-");
  if (check(body) !== parts.at(-1)) return WRONG_CODE;
  const entry = Object.entries(DRILLS).find(([, d]) => d.alias === parts[1]);
  if (!entry) return NEWER_APP;
  const [drillId, drill] = entry;
  const params: Params = {};
  if (parts.length === 5) {
    const pairs = parts[3].match(/[A-Z]\d+/g);
    if (!pairs || pairs.join("") !== parts[3]) return WRONG_CODE;
    for (const pair of pairs) {
      const f = drill.fields.find((f) => f.letter === pair[0]);
      if (!f) return NEWER_APP;
      if (Object.hasOwn(params, f.key)) return WRONG_CODE;
      const index = Number(pair.slice(1));
      if (!Number.isSafeInteger(index) || index >= f.values.length) return NEWER_APP;
      params[f.key] = f.values[index];
    }
  }
  return optionsProblem(drillId, params) ?? { drillId, seed: parts[2], params };
}

export function decodeChallenge(code: string): Challenge | null {
  const result = readChallenge(code);
  return typeof result === "string" ? null : result;
}

export function challengeProblem(code: string): string | null {
  const result = readChallenge(code);
  return typeof result === "string" ? result : null;
}

function sameContent(a: DrillPlan, b: DrillPlan): boolean {
  const params = (p: DrillPlan) => JSON.stringify(Object.keys(p.params).sort().map((key) => [key, p.params[key]]));
  const rounds = (p: DrillPlan) => JSON.stringify(p.rounds.map(({ card: _card, ...round }) => round));
  return a.sessionPrompt === b.sessionPrompt && a.contentId === b.contentId && params(a) === params(b) && rounds(a) === rounds(b);
}

/** Load only this drill's planner and verify both the played and bundled contexts. */
export async function challengeForPlan(plan: DrillPlan, ctx: PlanContext): Promise<string | null> {
  const drill = Object.hasOwn(DRILLS, plan.drill.id) ? DRILLS[plan.drill.id] : undefined;
  if (!drill || plan.drill.version !== 1) return null;
  const params: Params = {};
  for (const f of drill.fields) {
    const value = plan.params[f.key];
    if (typeof value === "string" || typeof value === "number") params[f.key] = value;
    else if (typeof value === "boolean") params[f.key] = String(value);
  }
  try {
    const code = encodeChallenge(plan.drill.id, plan.seed, params);
    const decoded = decodeChallenge(code);
    if (!decoded) return null;
    const module = await DRILL_MODULES[plan.drill.type]();
    const replay = module.plan(decoded.seed, decoded.params, ctx);
    const bundled = module.plan(decoded.seed, decoded.params, { ...ctx, prompts: PROMPTS });
    return sameContent(plan, replay) && sameContent(plan, bundled) ? code : null;
  } catch {
    return null;
  }
}
