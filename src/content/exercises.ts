import {
  BookOpen, Bomb, CalendarDays, Crown, Dice5, Dices, Gauge, Headphones, Highlighter, MessageSquareQuote, Presentation, Repeat2, Scale, Speech, Swords, TextQuote, Timer, Users,
  type LucideIcon,
} from "lucide-react";
import type { ExerciseDefinition, ExerciseType } from "@/lib/ipc/schemas";

/**
 * The four core exercises (§7, roadmap 7.2). Content rules for every file in
 * src/content: IDs never change once shipped; a change that alters how a past
 * session reads bumps CURRICULUM_VERSION in prompts.ts; each list has a test.
 */
export const EXERCISES: ExerciseDefinition[] = [
  {
    id: "ex-repeat",
    type: "repeat",
    version: 1,
    title: "Repeat an answer",
    purpose: "Say the same idea twice and make the second take clearer.",
    typicalMinutes: 6,
    example: "Describe one habit using point, reason, example.",
    instructions: [
      "Write up to three keywords: point, reason, example.",
      "Record about 60 seconds.",
      "Listen back and choose one thing to improve.",
      "Record the same answer again. The wording doesn't need to match.",
    ],
    attention: "Did you state your point early?",
  },
  {
    id: "ex-thought-groups",
    type: "thought_groups",
    version: 1,
    title: "Thought groups",
    purpose: "Finish one thought and leave space before the next.",
    typicalMinutes: 2,
    example: "Read a short passage with pause marks, then explain it freely.",
    instructions: [
      "Listen to or read the passage.",
      "Read it aloud, pausing at the marks.",
      "Hide the text and explain the idea in your own words.",
    ],
    attention: "Did you finish each thought before starting another?",
  },
  {
    id: "ex-imitate",
    type: "imitate",
    version: 1,
    title: "Listen and imitate",
    purpose: "Notice one feature of natural speech and try it yourself.",
    typicalMinutes: 3,
    example: "Repeat a 15-second clip, focusing on where the stress falls.",
    instructions: [
      "Listen to the clip once or twice.",
      "Choose one feature: emphasis, phrase rhythm, or clear endings.",
      "Record your repetition.",
      "Compare the two by listening, not by looking at waveforms.",
    ],
    attention: "Pick one feature. Ignore the rest for now.",
  },
  {
    id: "ex-expression",
    type: "expression",
    version: 1,
    title: "Use a better expression",
    purpose: "Make a saved expression your own by using it in new sentences.",
    typicalMinutes: 2,
    example: "Use “stumble over words” in three different sentences.",
    instructions: [
      "Read the expression and its explanation.",
      "Say or type three sentences that use it in different situations.",
      "Check that each sentence keeps the meaning you intended.",
    ],
    attention: "Can you use it in a situation you actually expect?",
  },
];

/** Phrases → Say it (roadmap 11.7): an exercise of its own, one Phrase practice session a day. Never change it. */
export const PHRASE_SAY_IT = { id: "ex-phrase-say-it", version: 1, type: "phrase_say_it" } as const;

/** Stored in sessions; never change them. */
export const EXERCISE_IDS = {
  repeat: "ex-repeat",
  thoughtGroups: "ex-thought-groups",
  imitate: "ex-imitate",
  expression: "ex-expression",
} as const;

export function exerciseFor(type: ExerciseType): ExerciseDefinition {
  const exercise = EXERCISES.find((e) => e.type === type);
  if (!exercise) throw new Error(`No exercise of type ${type}`);
  return exercise;
}

/**
 * Label and icon of every exercise type (roadmap 7.3, D-30): one place for the
 * Exercises cards, the Sessions table and its filter. A new exercise type adds
 * its entry here, next to `ExerciseType` and the Rust list.
 */
export const EXERCISE_TYPE_INFO: Record<ExerciseType, { label: string; icon: LucideIcon }> = {
  repeat: { label: "Repeat an answer", icon: Repeat2 },
  thought_groups: { label: "Thought groups", icon: TextQuote },
  imitate: { label: "Listen and imitate", icon: Headphones },
  expression: { label: "Better expression", icon: MessageSquareQuote },
  // Drills (M10), in the order of appendix C.1.
  jam: { label: "Just a Minute", icon: Timer },
  roulette: { label: "Topic roulette", icon: Dices },
  word_bomb: { label: "Word bomb", icon: Bomb },
  three_ways: { label: "Explain it three ways", icon: Users },
  emphasis: { label: "Emphasis game", icon: Highlighter },
  pace_ladder: { label: "Pace ladder", icon: Gauge },
  story_spine: { label: "Story spine", icon: BookOpen },
  story_cubes: { label: "Story cubes", icon: Dice5 },
  pitch: { label: "Elevator pitch", icon: Presentation },
  steelman: { label: "Steelman", icon: Scale },
  daily: { label: "Daily prompt", icon: CalendarDays },
  gauntlet: { label: "Gauntlet", icon: Swords },
  boss: { label: "Boss level", icon: Crown },
  // The learning engine (M11): a phrase said aloud during review.
  phrase_say_it: { label: "Phrase practice", icon: Speech },
};

/** The four core types, listed first in filters; other types appear once you have used them. */
export const CORE_EXERCISE_TYPES: readonly ExerciseType[] = ["repeat", "thought_groups", "imitate", "expression"];

/** The features you can choose to imitate; the choice is stored as the session focus (Listening 2 counts them). */
export const IMITATION_FEATURES = ["Emphasis: which word carries the stress", "Phrase rhythm", "Clear endings: where the voice falls"] as const;
