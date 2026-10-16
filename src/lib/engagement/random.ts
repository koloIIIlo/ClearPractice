/**
 * A small deterministic random generator for repeatable choices (blind A/B
 * order in 8.5; daily picks in the game layer, M9): the same seed always gives
 * the same sequence. Not for anything secret.
 */
export function seededRandom(seed: string): () => number {
  // FNV-1a hash of the seed, then mulberry32.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
