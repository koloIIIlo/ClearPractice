import type { WordCount } from "@/lib/ipc/schemas";

/**
 * Words you use often and hedges (roadmap 8.1, 8.11). The native core counts
 * the default lists with every take's measures; this is the same algorithm in
 * TypeScript, for the words you add yourself in Settings. Both are checked
 * against `fixtures/word-vectors.json`, so they always agree.
 */
export const WATCH_WORDS = ["basically", "actually", "literally", "honestly", "obviously", "you know", "i mean", "so yeah", "or something", "and stuff", "and so on"] as const;
export const HEDGES = ["maybe", "perhaps", "probably", "possibly", "i think", "i guess", "i suppose", "kind of", "sort of", "a bit", "a little bit", "somewhat", "i'm not sure"] as const;

/** Lowercase words without outer punctuation; curly apostrophes become straight ("I’m," → "i'm"). */
export function tokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/’/g, "'").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase())
    .filter(Boolean);
}

/**
 * Counts each item as a whole-word sequence. At each position the longest item
 * wins and its words are used up, so nothing is counted twice and "I mean"
 * never matches "I meant". Most frequent first, then in list order.
 */
export function countSequences(words: readonly string[], items: readonly string[], segmentOf: (index: number) => number = () => 0): WordCount[] {
  const parsed = items.map((item, index) => ({ index, parts: tokens(item) })).filter((p) => p.parts.length > 0);
  parsed.sort((a, b) => b.parts.length - a.parts.length || a.index - b.index);
  const counts = new Map<number, { count: number; segments: number[] }>();
  let i = 0;
  while (i < words.length) {
    const found = parsed.find((p) => i + p.parts.length <= words.length && p.parts.every((w, k) => words[i + k] === w));
    if (!found) {
      i += 1;
      continue;
    }
    const entry = counts.get(found.index) ?? { count: 0, segments: [] };
    entry.count += 1;
    const segment = segmentOf(i);
    if (!entry.segments.includes(segment)) entry.segments.push(segment);
    counts.set(found.index, entry);
    i += found.parts.length;
  }
  return [...counts.entries()]
    .sort(([a, x], [b, y]) => y.count - x.count || a - b)
    .map(([index, { count, segments }]) => ({ word: tokens(items[index]).join(" "), count, segments }));
}

/** Words of each segment, flattened, with the segment each word came from. */
function wordsOf(segments: readonly string[]): { words: string[]; segmentOf: (index: number) => number } {
  const words: string[] = [];
  const owners: number[] = [];
  segments.forEach((text, segment) => {
    for (const word of tokens(text)) {
      words.push(word);
      owners.push(segment);
    }
  });
  return { words, segmentOf: (index) => owners[index] ?? 0 };
}

/** The default words you use often plus your own (`extra`), counted together. */
export function countWatchWords(text: string | readonly string[], extra: readonly string[] = []): WordCount[] {
  const { words, segmentOf } = wordsOf(typeof text === "string" ? [text] : text);
  const items = [...WATCH_WORDS, ...extra.filter((w) => !(WATCH_WORDS as readonly string[]).includes(tokens(w).join(" ")))];
  return countSequences(words, items, segmentOf);
}

export function countHedges(text: string | readonly string[]): WordCount[] {
  const { words, segmentOf } = wordsOf(typeof text === "string" ? [text] : text);
  return countSequences(words, HEDGES, segmentOf);
}
