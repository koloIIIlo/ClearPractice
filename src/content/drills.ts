import { BookOpen, Bomb, CalendarDays, Crown, Dice5, Dices, Gauge, Highlighter, Presentation, Scale, Swords, Timer, Users, type LucideIcon } from "lucide-react";
import type { DrillType, ExerciseDefinition } from "@/lib/ipc/schemas";
import type { AreaId } from "@/lib/engagement/types";

/**
 * The drills of roadmap M10 (appendix C.1). Each is an exercise type of its
 * own (D-30) with a stored exercise definition `ex-<id>`. IDs never change
 * once shipped; a rule change that alters how a past round reads bumps
 * `version`.
 */
export type DrillDef = {
  /** In URLs: /drill/<id>. */
  id: string;
  type: DrillType;
  version: number;
  title: string;
  /** One line on the card. */
  tagline: string;
  /** Shown before you start. */
  rules: readonly string[];
  minutes: number;
  areas: readonly AreaId[];
  exerciseId: string;
  icon: LucideIcon;
  /** The full result needs a transcript (local Whisper or a cloud transcript). */
  needsTranscript: boolean;
  /** What counts as one round for levels and achievements: a take, or a whole session. */
  unit: "take" | "session";
  defaults: Readonly<Record<string, number | string | boolean>>;
  /** A suggestion only; nothing is ever locked (9.15). */
  recommendedAfter?: { area: AreaId; level: number };
};

export const DRILLS: readonly DrillDef[] = [
  {
    id: "jam", type: "jam", version: 1, title: "Just a Minute", exerciseId: "ex-jam", icon: Timer, minutes: 2, areas: ["fluency", "spontaneity"], needsTranscript: true, unit: "take",
    tagline: "Speak for 60 seconds without hesitating, repeating yourself or going off topic.",
    rules: [
      "You get a topic and 5 seconds to think.",
      "Speak for 60 seconds. The take stops by itself.",
      "Press F when you notice a slip: a hesitation, a repeat or going off topic.",
      "Clean seconds are an estimate from the transcript and the audio, never a judgement of your voice.",
    ],
    defaults: { think: 5, speak: 60 },
  },
  {
    id: "roulette", type: "roulette", version: 1, title: "Topic roulette", exerciseId: "ex-roulette", icon: Dices, minutes: 2, areas: ["spontaneity"], needsTranscript: false, unit: "take",
    tagline: "Spin for a topic, think for 10 seconds, then speak.",
    rules: [
      "Spin the wheel for a category and a topic. You can spin again once.",
      "Think for 10 seconds, then speak.",
      "Green means you reached the minimum time, amber means start finishing, red means time.",
    ],
    defaults: { think: 10, speak: 60 },
  },
  {
    id: "word-bomb", type: "word_bomb", version: 1, title: "Word bomb", exerciseId: "ex-word-bomb", icon: Bomb, minutes: 2, areas: ["vocabulary", "spontaneity"], needsTranscript: true, unit: "take",
    tagline: "Weave surprise words into your answer as they appear.",
    rules: ["Answer a familiar question for 90 seconds.", "Three words appear while you speak.", "Use each word in your answer as soon as you can."],
    defaults: { speak: 90, bombs: 3 },
    recommendedAfter: { area: "vocabulary", level: 2 },
  },
  {
    id: "three-ways", type: "three_ways", version: 1, title: "Explain it three ways", exerciseId: "ex-three-ways", icon: Users, minutes: 5, areas: ["structure", "spontaneity"], needsTranscript: false, unit: "session",
    tagline: "Explain the same thing to a child, a colleague and an expert.",
    rules: [
      "Choose something you can explain.",
      "Explain it three times, once for each listener. Stop when you are done.",
      "Afterwards, choose which version fitted its listener best.",
    ],
    defaults: { rounds: 3 },
  },
  {
    id: "emphasis", type: "emphasis", version: 1, title: "Emphasis game", exerciseId: "ex-emphasis", icon: Highlighter, minutes: 3, areas: ["voice"], needsTranscript: false, unit: "session",
    tagline: "Stress a different word and hear the meaning change.",
    rules: [
      "Read each sentence aloud, stressing the word in bold.",
      "Seven short rounds; stop each one when you finish the sentence.",
      "The app estimates which word carried the strongest beat. You can always judge it yourself.",
    ],
    defaults: { rounds: 7 },
  },
  {
    id: "pace-ladder", type: "pace_ladder", version: 1, title: "Pace ladder", exerciseId: "ex-pace-ladder", icon: Gauge, minutes: 3, areas: ["voice"], needsTranscript: false, unit: "session",
    tagline: "Say the same answer slowly, naturally, then quickly.",
    rules: [
      "Three rounds of 30 seconds on the same question.",
      "First slowly, then at your natural speed, then quickly.",
      "Range, not speed: being able to slow down on purpose is the skill.",
    ],
    defaults: { think: 5, speak: 30 },
  },
  {
    id: "story-spine", type: "story_spine", version: 1, title: "Story spine", exerciseId: "ex-story-spine", icon: BookOpen, minutes: 2, areas: ["storytelling"], needsTranscript: false, unit: "take",
    tagline: "Tell a 90-second story, one step of the spine at a time.",
    rules: ["Start from a story seed.", "Follow the cards from Once upon a time to Ever since then.", "Press the right arrow key or Next card to move on."],
    defaults: { speak: 90, autoAdvance: false },
  },
  {
    id: "story-cubes", type: "story_cubes", version: 1, title: "Story cubes", exerciseId: "ex-story-cubes", icon: Dice5, minutes: 2, areas: ["storytelling", "spontaneity"], needsTranscript: true, unit: "take",
    tagline: "Roll picture cubes and tell a story that uses them all.",
    rules: ["Roll 3 to 6 cubes. You can roll once more.", "Think for 15 seconds, then tell a story of up to 90 seconds.", "Try to include every picture."],
    defaults: { cubes: 4, think: 15, speak: 90 },
  },
  {
    id: "pitch", type: "pitch", version: 1, title: "Elevator pitch", exerciseId: "ex-pitch", icon: Presentation, minutes: 3, areas: ["structure"], needsTranscript: false, unit: "session",
    tagline: "Say one idea in 60, then 30, then 15 seconds.",
    rules: ["Choose or type one idea.", "Pitch it in 60 seconds, then 30, then 15.", "Each round stops at its limit."],
    defaults: { think: 10 },
  },
  {
    id: "steelman", type: "steelman", version: 1, title: "Steelman", exerciseId: "ex-steelman", icon: Scale, minutes: 3, areas: ["spontaneity", "structure"], needsTranscript: false, unit: "session",
    tagline: "Argue the other side as well as you can.",
    rules: ["Pick an opinion question and say where you stand.", "Argue the side you didn't choose for 90 seconds.", "Then answer its strongest objection in 60 seconds."],
    defaults: { think: 15 },
  },
  {
    id: "daily", type: "daily", version: 1, title: "Daily prompt", exerciseId: "ex-daily", icon: CalendarDays, minutes: 2, areas: ["spontaneity"], needsTranscript: true, unit: "session",
    tagline: "One prompt a day, the same for everyone, with one official try.",
    rules: [
      "Think for 10 seconds, then speak for 60.",
      "Your first take of the day is the official one; more takes are practice.",
      "You can copy a grid of how it flowed. It never includes your words.",
    ],
    defaults: { think: 10, speak: 60 },
  },
  {
    id: "gauntlet", type: "gauntlet", version: 1, title: "Gauntlet", exerciseId: "ex-gauntlet", icon: Swords, minutes: 5, areas: ["spontaneity", "fluency"], needsTranscript: false, unit: "session",
    tagline: "Five rounds back to back, each a little harder.",
    rules: ["Five rounds with short thinking time.", "From a familiar question to arguing the other side.", "A round counts when you speak for 10 seconds or more."],
    defaults: { rounds: 5 },
    recommendedAfter: { area: "spontaneity", level: 3 },
  },
  {
    id: "boss", type: "boss", version: 1, title: "Boss levels", exerciseId: "ex-boss", icon: Crown, minutes: 6, areas: ["structure", "spontaneity", "storytelling", "courage"], needsTranscript: false, unit: "session",
    tagline: "Bigger challenges: an interview, a sceptical panel, a toast and an interrupted meeting.",
    rules: ["Choose a boss.", "Each has several rounds and a final question for you to answer yourself.", "The questions are written in advance; nothing is sent anywhere."],
    defaults: {},
  },
];

export function drillById(id: string): DrillDef | undefined {
  return DRILLS.find((d) => d.id === id);
}

export function drillForType(type: DrillType): DrillDef {
  const drill = DRILLS.find((d) => d.type === type);
  if (!drill) throw new Error(`No drill of type ${type}`);
  return drill;
}

/** Each drill's stored exercise definition (D-30); sessions record `ex-<id>` version 1. */
export const DRILL_EXERCISES: readonly ExerciseDefinition[] = DRILLS.map((d) => ({
  id: d.exerciseId,
  type: d.type,
  version: d.version,
  title: d.title,
  purpose: d.tagline,
  typicalMinutes: d.minutes,
  example: d.rules[0],
  instructions: [...d.rules],
  attention: d.tagline,
}));
