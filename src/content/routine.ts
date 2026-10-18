import type { RoutineStepId } from "@/lib/ipc/schemas";

/**
 * The 3-minute pre-talk routine (roadmap 12.3, appendix C.7). Every step can
 * be skipped and it works offline. Power poses are left out on purpose: the
 * original effect didn't replicate (Ranehill et al. 2015).
 */
export type RoutineStep = { id: RoutineStepId; title: string; seconds: number; how: string; why: string; source: string };

export const ROUTINE_STEPS: readonly RoutineStep[] = [
  {
    id: "breathe", title: "Cyclic sighing", seconds: 60,
    how: "Breathe in through your nose, take a second short breath in, then breathe out slowly through your mouth. About five rounds.",
    why: "A long, slow breath out is one of the quickest ways to settle your body.",
    source: "Balban et al. 2023",
  },
  {
    id: "warm_up", title: "Voice warm-up", seconds: 45,
    how: "Lip trills for 15 seconds, then sirens from low to high for 15 seconds, then say the tongue twister slowly, then at a normal pace.",
    why: "A warm voice starts steadier and carries further.",
    source: "common voice practice",
  },
  {
    id: "reframe", title: "Reframe", seconds: 15,
    how: "Say out loud: “I'm excited.”",
    why: "A fast heartbeat feels the same whether you call it nerves or excitement. Calling it excitement helps you use it.",
    source: "Brooks 2014",
  },
  {
    id: "unload", title: "Unload", seconds: 60,
    how: "Write down any worries for one minute. When the minute is up, the text is thrown away unless you choose to keep it.",
    why: "Writing worries down frees attention for the talk.",
    source: "Ramirez & Beilock 2011",
  },
  {
    id: "encourage", title: "Encourage", seconds: 15,
    how: "Say the line below out loud, using your own name.",
    why: "Talking to yourself by name, as you would to a friend, steadies you.",
    source: "Kross et al. 2014",
  },
];

/** Breathing cue timings (seconds): inhale, second inhale, long exhale. */
export const BREATH = { inhale: 2, top: 1, exhale: 6 } as const;
export const BREATH_ROUNDS = 5;

/** One tongue twister per run, chosen by the date (appendix C.7). */
export const TONGUE_TWISTERS: readonly string[] = [
  "Red lorry, yellow lorry.",
  "She sells seashells by the seashore.",
  "Unique New York.",
  "A proper copper coffee pot.",
  "Six slippery snails slid slowly seaward.",
  "Fresh French fried fish.",
  "Which wristwatches are Swiss wristwatches?",
  "Thin sticks, thick bricks.",
  "Lesser leather never weathered wetter weather better.",
  "Good blood, bad blood.",
];

/** The encouragement, with your name, or "you" without one. */
export function encouragement(name: string): string {
  const who = name.trim();
  return who ? `You've got this, ${who}. You've prepared.` : "You've got this. You've prepared.";
}
