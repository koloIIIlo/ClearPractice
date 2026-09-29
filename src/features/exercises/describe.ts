import type { PromptTag, TaskConditions } from "@/lib/ipc/schemas";

export const TAG_LABELS: Record<PromptTag, string> = {
  daily_life: "Daily life",
  explanations: "Explanations",
  opinions: "Opinions",
  work: "Work",
  storytelling: "Storytelling",
  unexpected: "Unexpected questions",
};

/**
 * Task demands in plain words, e.g. "90 s · unfamiliar topic · 30 s to prepare · one follow-up".
 * Deliberately not a C1/C2-style badge (§6 Exercises).
 */
export function describeDemands(c: TaskConditions): string[] {
  const parts = [
    c.targetSeconds >= 120 ? `${c.targetSeconds / 60} min` : `${c.targetSeconds} s`,
    c.familiarity === "unfamiliar" ? "unfamiliar topic" : "familiar topic",
    c.preparationSeconds === 0 ? "no preparation" : `${c.preparationSeconds} s to prepare`,
  ];
  if (c.audience) parts.push(`for ${c.audience.toLowerCase()}`);
  if (c.followUp) parts.push("one follow-up");
  return parts;
}
