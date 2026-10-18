/**
 * A word-level comparison for the upgrade loop (roadmap 13.10): the longest
 * common sequence of normalised words (lower case, without punctuation), with
 * each word shown as it was written. Words only in the first text are "del",
 * words only in the second are "add"; neighbours of one kind are joined.
 */
export type DiffPart = { op: "same" | "add" | "del"; text: string };

type Token = { text: string; key: string };

const tokens = (text: string): Token[] =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ({ text: word, key: word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "") }));

export function diffWords(a: string, b: string): DiffPart[] {
  const left = tokens(a);
  const right = tokens(b);
  const n = left.length;
  const m = right.length;
  // lcs[i][j]: the common length of left[i..] and right[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = left[i].key === right[j].key ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  const push = (op: DiffPart["op"], text: string) => {
    const last = out[out.length - 1];
    if (last?.op === op) last.text += ` ${text}`;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i].key === right[j].key) {
      push("same", right[j].text);
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push("del", left[i].text);
      i += 1;
    } else {
      push("add", right[j].text);
      j += 1;
    }
  }
  while (i < n) push("del", left[i++].text);
  while (j < m) push("add", right[j++].text);
  return out;
}
