import { expect, it } from "vitest";
import { PROMPTS } from "@/content/prompts";
import { GUIDES } from "@/content/guides";
import { phrases } from "./ipc/mock-data";
import { searchLibrary } from "./search";

it("searches your phrases, all prompts including yours, and the guides' full text (3.13)", () => {
  const mine = { ...PROMPTS[0], id: "user-prompt-1", text: "Explain our deploy pipeline to a new colleague", source: "user" as const };
  const hits = searchLibrary("deploy colleague", phrases, [mine, ...PROMPTS], GUIDES);
  expect(hits).toContainEqual(expect.objectContaining({ kind: "prompt", id: "user-prompt-1", excerpt: "Your prompt" }));
  const guideWord = GUIDES[0].sections[0].paragraphs[0].split(" ").find((w) => w.length > 6)!.replace(/[^a-z]/gi, "");
  expect(searchLibrary(guideWord, [], [], GUIDES).some((h) => h.kind === "guide")).toBe(true);
  expect(searchLibrary(phrases[0].expression.split(" ")[0], phrases, [], []).some((h) => h.kind === "phrase")).toBe(true);
  expect(searchLibrary("   ", phrases, PROMPTS, GUIDES)).toEqual([]);
});
