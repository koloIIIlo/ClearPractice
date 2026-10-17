/**
 * Shared rules for the content tests (roadmap 10.15, appendix C): unique IDs,
 * no duplicates after normalising case and punctuation, and length limits.
 */
export const ID_PATTERN = /^[a-z0-9-]{1,40}$/;

/** Lowercase, punctuation removed, spaces collapsed: "Tea, please!" → "tea please". */
export const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Normalised texts that occur more than once. */
export function duplicates(texts: readonly string[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const text of texts.map(normalize)) (seen.has(text) ? twice : seen).add(text);
  return [...twice];
}

/** Texts longer than `max` characters. */
export function tooLong(texts: readonly string[], max: number): string[] {
  return texts.filter((t) => t.length > max);
}

/** Topics ≤ 80 characters, prompts and questions ≤ 160, instructions ≤ 200 (appendix C). */
export const LIMITS = { topic: 80, prompt: 160, instruction: 200 } as const;
