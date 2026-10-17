import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { usePreferences } from "@/lib/ipc/queries";
import type { Preferences } from "@/lib/ipc/schemas";

/**
 * Practice style (roadmap 7.5, D-32): Playful shows the game layer, Calm hides
 * it. Progress is recorded either way, so switching back shows everything.
 */
export type EffectiveStyle = { playful: boolean; celebrations: "full" | "subtle" | "off"; sounds: boolean };

/** The one-time Playful-or-Calm card on Today, on since the game layer exists (roadmap 9.1). */
export const SHOW_STYLE_CARD = true;

/** Calm turns celebrations and their sound off; reduced motion turns "full" into "subtle". */
export function effectiveStyle(p: Pick<Preferences, "practiceStyle" | "celebrations" | "celebrationSounds">, reducedMotion: boolean): EffectiveStyle {
  if (p.practiceStyle === "calm") return { playful: false, celebrations: "off", sounds: false };
  const celebrations = p.celebrations === "full" && reducedMotion ? "subtle" : p.celebrations;
  return { playful: true, celebrations, sounds: p.celebrationSounds && celebrations !== "off" };
}

export function usePracticeStyle(): EffectiveStyle {
  const { preferences } = usePreferences();
  return effectiveStyle(preferences, useReducedMotion());
}
