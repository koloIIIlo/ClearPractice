import { seededRandom } from "@/lib/engagement/random";
import type { PracticePrompt, PromptTag } from "@/lib/ipc/schemas";

/** Deterministic choices for drill plans (10.1): the same seed, the same plan. */
export type Rand = () => number;
export const rng = (seed: string, salt = ""): Rand => seededRandom(`${seed}:${salt}`);

export function pick<T>(rand: Rand, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length) % items.length];
}

/** `n` distinct items in a seeded order. */
export function sample<T>(rand: Rand, items: readonly T[], n: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
}

/** A fresh seed for a new play: letters, digits and dashes only (7.3). */
export const newSeed = () => crypto.randomUUID().slice(0, 13);

/** Bundled prompts that match, falling back to all bundled prompts. */
export function promptsWhere(prompts: readonly PracticePrompt[], match: (p: PracticePrompt) => boolean): PracticePrompt[] {
  const bundled = prompts.filter((p) => p.source === "bundled");
  const matching = bundled.filter(match);
  return matching.length > 0 ? matching : bundled.length > 0 ? bundled : [...prompts];
}

export const hasTag = (tag: PromptTag) => (p: PracticePrompt) => p.tags.includes(tag);

/** A stand-in when no prompt is available (the content pack always has some). */
export const FALLBACK_PROMPT = "Describe a place you know well.";
