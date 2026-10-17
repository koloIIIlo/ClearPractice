import type { Preferences } from "@/lib/ipc/schemas";

/**
 * Feedback timing (roadmap 11.4): you choose when you see measures. Learners
 * who chose when to get feedback learned better than those who got it every
 * time (Chiviacowsky & Wulf 2002). "What went well" and the self-check always
 * stay visible; only Flow and Words fold.
 */
export const FADE_AFTER_TAKES = 5;
export const FADE_FROM_FLUENCY = 3;

export const MEASURES_TIMING: readonly { value: Preferences["measuresTiming"]; label: string; hint: string }[] = [
  { value: "always", label: "After every take", hint: "Flow and Words show under every take." },
  { value: "on_request", label: "When I ask", hint: "They stay folded behind Show measures." },
  { value: "fade", label: "Fewer as I improve", hint: `They show for your first ${FADE_AFTER_TAKES} takes with a new focus and until Fluency ${FADE_FROM_FLUENCY}, then fold.` },
];

/** Whether Flow and Words start folded for this take. */
export function shouldFoldMeasures(pref: Preferences["measuresTiming"], ctx: { takesWithFocus: number; fluencyLevel: number }): boolean {
  if (pref === "on_request") return true;
  if (pref === "fade") return ctx.takesWithFocus > FADE_AFTER_TAKES && ctx.fluencyLevel >= FADE_FROM_FLUENCY;
  return false;
}
