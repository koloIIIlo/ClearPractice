import type { Guide, PhraseCard, PracticePrompt, SearchHit } from "./ipc/schemas";

const has = (text: string | null | undefined, terms: string[]) => {
  const t = (text ?? "").toLowerCase();
  return terms.every((term) => t.includes(term));
};

/**
 * Search over your phrases, prompts (bundled and your own) and the guides'
 * full text (3.13). Every word must match; sessions are searched natively.
 */
export function searchLibrary(query: string, phrases: PhraseCard[], prompts: PracticePrompt[], guides: Guide[]): SearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return [
    ...phrases
      .filter((p) => has(`${p.expression} ${p.original} ${p.explanation} ${p.examples.join(" ")}`, terms))
      .map((p): SearchHit => ({ kind: "phrase", id: p.id, title: p.expression, excerpt: p.explanation || `Instead of “${p.original}”`, href: `/phrases?focus=${p.id}` })),
    ...prompts
      .filter((p) => has(`${p.text} ${p.conditions.audience ?? ""}`, terms))
      .map((p): SearchHit => ({ kind: "prompt", id: p.id, title: p.text, excerpt: p.source === "user" ? "Your prompt" : null, href: `/exercises?tab=prompts&prompt=${p.id}` })),
    ...guides
      .filter((g) => has(`${g.title} ${g.summary} ${g.sections.map((s) => `${s.heading} ${s.paragraphs.join(" ")}`).join(" ")}`, terms))
      .map((g): SearchHit => ({ kind: "guide", id: g.id, title: g.title, excerpt: g.summary, href: `/exercises?tab=guides&guide=${g.id}` })),
  ].slice(0, 30);
}
