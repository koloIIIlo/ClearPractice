import { expect, it } from "vitest";
import { PracticePrompt } from "@/lib/ipc/schemas";
import { CURRICULUM_VERSION, PROMPTS } from "./prompts";

it("bundles 40 valid prompts with unique ids and a version (4.1, 4.5)", () => {
  expect(CURRICULUM_VERSION).toBeGreaterThanOrEqual(1);
  expect(PROMPTS).toHaveLength(40);
  expect(new Set(PROMPTS.map((p) => p.id)).size).toBe(40);
  for (const p of PROMPTS) {
    expect(() => PracticePrompt.parse(p), p.id).not.toThrow();
    expect(p.source).toBe("bundled");
    expect(p.text.trim()).toMatch(/[.?]$/);
    expect(p.conditions.targetSeconds).toBeGreaterThanOrEqual(60);
  }
});

it("mixes familiar and unfamiliar tasks and covers every D-19 subject", () => {
  const unfamiliar = PROMPTS.filter((p) => p.conditions.familiarity === "unfamiliar").length;
  expect(unfamiliar).toBeGreaterThanOrEqual(15);
  expect(PROMPTS.length - unfamiliar).toBeGreaterThanOrEqual(15);
  expect(PROMPTS.filter((p) => p.conditions.followUp).length).toBeGreaterThanOrEqual(8);
  for (const subject of ["prog", "econ", "crypto", "sport", "belief", "anime", "book"]) {
    expect(PROMPTS.some((p) => p.id.startsWith(`p-${subject}-`)), subject).toBe(true);
  }
});
