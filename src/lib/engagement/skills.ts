import { AudioLines, BookOpenText, Ear, Flag, ListOrdered, ScrollText, Waves, Zap, type LucideIcon } from "lucide-react";
import { EXERCISE_IDS, IMITATION_FEATURES } from "@/content/exercises";
import type { Criterion } from "./criteria";
import type { AreaId } from "./types";

/**
 * The eight skill areas and their five levels (roadmap 9.2, appendix A). A
 * level is earned with practice evidence and your own notes, in order, and is
 * never taken away. Bump the version when criteria change: stored levels stay.
 */
export const LEVEL_DEFINITIONS_VERSION = 1;

export type AreaDef = { id: AreaId; title: string; short: string; trains: string; why: string; icon: LucideIcon };
/** A place to practise a level; `arrives` names the milestone that builds it (hidden until then). */
export type PractiseLink = { label: string; to: string; arrives?: string };
export type LevelDef = { level: 1 | 2 | 3 | 4 | 5; name: string; description: string; criteria: Criterion[]; practise: PractiseLink[] };

export const AREAS: readonly AreaDef[] = [
  { id: "structure", title: "Structure & clarity", short: "Structure", trains: "Point first, reason and example, a clear ending", why: "Listeners follow a point they hear early. Structure is the fastest way to be understood.", icon: ListOrdered },
  { id: "fluency", title: "Fluency", short: "Fluency", trains: "Noticing hesitations, pausing instead, steady flow", why: "Hesitation is normal in a second language. Noticing it and pausing calmly helps listeners more than rushing.", icon: Waves },
  { id: "voice", title: "Voice & delivery", short: "Voice", trains: "Endings, rhythm, pace range, emphasis", why: "Where your voice rises, falls and stresses carries meaning beyond the words.", icon: AudioLines },
  { id: "spontaneity", title: "Spontaneity", short: "Spontaneity", trains: "Unfamiliar topics, little preparation, follow-ups", why: "Real conversations rarely give you time to prepare. Practising without notes transfers best.", icon: Zap },
  { id: "vocabulary", title: "Vocabulary & phrasing", short: "Vocabulary", trains: "Saving, reviewing and using natural expressions", why: "A phrase you have said aloud in your own sentence comes back when you need it.", icon: BookOpenText },
  { id: "listening", title: "Listening & imitation", short: "Listening", trains: "Shadowing, imitating features, learning from models", why: "Copying a model trains your ear and your mouth together.", icon: Ear },
  { id: "storytelling", title: "Storytelling", short: "Storytelling", trains: "Sequence, concrete detail, telling on the spot", why: "Stories are how people remember what you said.", icon: ScrollText },
  { id: "courage", title: "Real-world courage", short: "Courage", trains: "Real conversations, graded steps, events", why: "Practice counts most when it reaches real people.", icon: Flag },
];

const repeat: PractiseLink = { label: "Record and repeat", to: `/practice/${EXERCISE_IDS.repeat}` };
const imitate: PractiseLink = { label: "Listen and imitate", to: `/practice/${EXERCISE_IDS.imitate}` };
const expression: PractiseLink = { label: "Use a better expression", to: `/practice/${EXERCISE_IDS.expression}` };
const prompts: PractiseLink = { label: "Unfamiliar prompts", to: "/exercises?tab=prompts" };
const storyPrompts: PractiseLink = { label: "Storytelling prompts", to: "/exercises?tab=prompts" };
const newSituation: PractiseLink = { label: "This week's new situation", to: "/" };
const real: PractiseLink = { label: "Note a real conversation", to: "/progress?view=real" };
const sessions: PractiseLink = { label: "Review a take", to: "/sessions" };
const phrases: PractiseLink = { label: "Save phrases", to: "/phrases" };
const phraseReview: PractiseLink = { label: "Review your phrases", to: "/phrases?review=1" };
/** The conversation partner (M13). */
const partner: PractiseLink = { label: "Practice conversation", to: "/partner" };
const upgrade: PractiseLink = { label: "Upgrade a recent answer", to: "/sessions" };
/** A drill (M10), by its title, opening in the drill studio. */
const DRILL_PATHS: Record<string, string> = {
  "Just a Minute": "jam", "Topic roulette": "roulette", "Elevator pitch": "pitch", "Emphasis game": "emphasis", "Gauntlet": "gauntlet",
  "Pace ladder": "pace-ladder", "Story cubes": "story-cubes", "Story spine": "story-spine",
};
const drill = (label: string): PractiseLink => ({ label, to: `/drill/${DRILL_PATHS[label]}` });
const later = (label: string, arrives: string): PractiseLink => ({ label, to: "/", arrives });
const ladder: PractiseLink = { label: "Exposure ladder", to: "/confidence" };
const bosses: PractiseLink = { label: "Boss levels", to: "/drill/boss" };

const MIN = 60_000;
const firstUnknown = { familiarity: "unfamiliar" as const, firstTakeOnly: true };

export const LEVELS: Readonly<Record<AreaId, readonly LevelDef[]>> = {
  structure: [
    { level: 1, name: "Point first", description: "Write your main point in the outline before you speak.",
      criteria: [{ kind: "sessions", label: "3 sessions where you wrote your point in the outline", filter: { outline: ["point"] }, atLeast: 3 }], practise: [repeat] },
    { level: 2, name: "Reason and example", description: "Back the point with a reason and an example.",
      criteria: [{ kind: "sessions", label: "3 sessions with a point, a reason and an example", filter: { outline: ["point", "reason", "example"], minTakes: 1 }, atLeast: 3, distinctDays: 2 }], practise: [repeat] },
    { level: 3, name: "Clear ending", description: "Finish with a sentence that sums up.",
      criteria: [{ kind: "takes", label: "3 takes where you noted a clear ending", filter: { check: { id: "clear_ending", value: true } }, atLeast: 3, distinctDays: 2 }], practise: [repeat, drill("Elevator pitch")] },
    { level: 4, name: "Structured on the spot", description: "Open with your point on an unfamiliar question with little preparation.",
      criteria: [{ kind: "takes", label: "3 unfamiliar first answers where you noted your point came first", filter: { ...firstUnknown, maxPrepSeconds: 15, check: { id: "point_first", value: true } }, atLeast: 3, distinctDays: 2 }],
      practise: [newSituation, prompts, drill("Topic roulette")] },
    { level: 5, name: "Understood", description: "A listener gets your main point without asking.",
      criteria: [{ kind: "anyOf", label: "Twice, a listener told you your main point without asking what you meant", options: [
        { kind: "transfers", label: "2 reflections with the listener's words and no clarification needed", listenerWords: true, noClarification: true, atLeast: 2 },
        { kind: "listenerAnswers", label: "2 listener answers that name your main point", mainPointAnswered: true, atLeast: 2 },
      ] }], practise: [real, later("Ask a listener", "Listener packs")] },
  ],
  fluency: [
    { level: 1, name: "Aware", description: "Notice your hesitations by reviewing them.",
      criteria: [{ kind: "takes", label: "Review the hesitation candidates in 3 takes (a take with none counts)", filter: { transcribed: true, fillersReviewed: true }, atLeast: 3 }], practise: [sessions] },
    { level: 2, name: "Replacing", description: "Let a short pause take the place of a hesitation.",
      criteria: [{ kind: "takes", label: "3 reviewed takes with clearly fewer confirmed hesitations than your first five",
        filter: { fillersReviewed: true, minSpeechMs: 45_000, metric: { key: "confirmedPer100", op: "<=", value: { baseline: "first5ReviewedMedian", factor: 0.7 } } }, atLeast: 3, distinctDays: 2 }],
      practise: [repeat, later("Filler programme", "the learning engine")] },
    { level: 3, name: "Steady", description: "Pause between thoughts, not in the middle of one.",
      criteria: [{ kind: "takes", label: "2 familiar answers of a minute or more with at most one pause inside a clause", filter: { familiarity: "familiar", minSpeechMs: MIN, metric: { key: "midClausePauses", op: "<=", value: 1 } }, atLeast: 2 }],
      practise: [repeat, drill("Just a Minute")] },
    { level: 4, name: "Under pressure", description: "Stay steady on an unfamiliar question.",
      criteria: [{ kind: "anyOf", label: "2 unfamiliar first answers of a minute or more with at most one pause inside a clause", options: [
        { kind: "takes", label: "2 unfamiliar first answers of a minute or more with at most one pause inside a clause",
          filter: { ...firstUnknown, maxPrepSeconds: 15, minSpeechMs: MIN, metric: { key: "midClausePauses", op: "<=", value: 1 } }, atLeast: 2, distinctDays: 2 },
        { kind: "activity", label: "45 clean seconds in Just a Minute, twice", type: "jam", result: { key: "cleanSeconds", op: ">=", value: 45 }, atLeast: 2 },
      ] }], practise: [prompts, drill("Just a Minute"), drill("Topic roulette")] },
    { level: 5, name: "Natural", description: "Real conversations that flowed, plus follow-up practice.",
      criteria: [{ kind: "allOf", label: "Two real conversations that flowed, plus follow-up practice", parts: [
        { kind: "transfers", label: "2 real conversations you noted as flowing smoothly", flow: ["smooth"], atLeast: 2 },
        { kind: "anyOf", label: "Follow-up practice", options: [
          { kind: "conversation", label: "A practice conversation of 5 turns", minTurns: 5, atLeast: 1 },
          { kind: "sessions", label: "Answer follow-up questions in 3 sessions", filter: { followUp: true, minTakes: 2 }, atLeast: 3 },
        ] },
      ] }], practise: [real, partner, prompts] },
  ],
  voice: [
    { level: 1, name: "Listening back", description: "Look at where your voice rises and falls.",
      criteria: [{ kind: "takes", label: "Open the intonation track of 3 takes", filter: { prosodyViewed: true }, atLeast: 3 }], practise: [sessions] },
    { level: 2, name: "Shaping endings", description: "Imitate a model's endings and rhythm, more than once.",
      criteria: [{ kind: "sessions", label: "3 imitation sessions with two or more takes", filter: { exercise: ["imitate"], minTakes: 2 }, atLeast: 3, distinctDays: 2 }], practise: [imitate] },
    { level: 3, name: "Range", description: "Speak at clearly different speeds on purpose.",
      criteria: [{ kind: "activity", label: "Three clearly different speeds in the pace ladder", type: "pace_ladder", result: { key: "distinctSpeeds", op: ">=", value: 3 }, atLeast: 1 }], practise: [drill("Pace ladder")] },
    { level: 4, name: "Emphasis", description: "Put the stress where the meaning is.",
      criteria: [{ kind: "activity", label: "5 estimated hits in the emphasis game, on 2 days", type: "emphasis", result: { key: "estimatedHits", op: ">=", value: 5 }, atLeast: 2, distinctDays: 2 }], practise: [drill("Emphasis game")] },
    { level: 5, name: "Expressive", description: "Vary your voice on purpose in longer talks.",
      criteria: [{ kind: "allOf", label: "Two longer takes where you varied your voice, plus a bigger moment", parts: [
        { kind: "takes", label: "2 takes of 90 s or more where you noted varying your voice", filter: { minSpeechMs: 90_000, check: { id: "varied_voice", value: true } }, atLeast: 2 },
        { kind: "anyOf", label: "A talk rehearsal, a boss level or a practice conversation", options: [
          { kind: "activity", label: "A talk rehearsal", type: "rehearsal", atLeast: 1 },
          { kind: "activity", label: "A boss level", type: "boss", atLeast: 1 },
          { kind: "conversation", label: "A practice conversation of 5 turns", minTurns: 5, atLeast: 1 },
        ] },
      ] }], practise: [repeat, partner, later("Talk rehearsal", "events")] },
  ],
  spontaneity: [
    { level: 1, name: "First unknown", description: "Answer a question you haven't prepared.",
      criteria: [{ kind: "sessions", label: "1 unfamiliar question", filter: { familiarity: "unfamiliar" }, atLeast: 1 }], practise: [newSituation, prompts] },
    { level: 2, name: "Short notice", description: "Answer with half a minute or less to prepare.",
      criteria: [{ kind: "sessions", label: "3 unfamiliar questions with 30 seconds or less to prepare", filter: { familiarity: "unfamiliar", maxPrepSeconds: 30 }, atLeast: 3, distinctDays: 2 }], practise: [prompts] },
    { level: 3, name: "No notice", description: "Answer with almost no time to prepare.",
      criteria: [{ kind: "anyOf", label: "3 unfamiliar questions answered with 10 seconds or less to prepare", options: [
        { kind: "sessions", label: "3 unfamiliar questions answered with 10 seconds or less to prepare", filter: { familiarity: "unfamiliar", maxPrepSeconds: 10 }, atLeast: 3, distinctDays: 2 },
        { kind: "activity", label: "3 rounds of topic roulette, on 2 days", type: "roulette", atLeast: 3, distinctDays: 2 },
      ] }], practise: [prompts, drill("Topic roulette")] },
    { level: 4, name: "Follow-ups", description: "Keep going when a follow-up question comes.",
      criteria: [{ kind: "sessions", label: "Answer follow-up questions in 3 sessions", filter: { followUp: true, minTakes: 2 }, atLeast: 3, distinctDays: 2 }], practise: [prompts] },
    { level: 5, name: "Gauntlet", description: "Several questions in a row, on the spot.",
      criteria: [{ kind: "anyOf", label: "Five rounds of the gauntlet, or a practice conversation of 6 turns", options: [
        { kind: "activity", label: "Five rounds of the gauntlet", type: "gauntlet", result: { key: "roundsCompleted", op: ">=", value: 5 }, atLeast: 1 },
        { kind: "conversation", label: "A practice conversation of 6 turns", minTurns: 6, atLeast: 1 },
      ] }], practise: [drill("Gauntlet"), partner] },
  ],
  vocabulary: [
    { level: 1, name: "Collector", description: "Keep expressions you want to use.",
      criteria: [{ kind: "phrases", label: "Save 5 phrases of your own", saved: 5 }], practise: [phrases] },
    { level: 2, name: "Reviewer", description: "Recall them on several days.",
      criteria: [{ kind: "phrases", label: "20 phrase reviews on 5 days", reviews: 20, reviewDays: 5 }], practise: [phraseReview] },
    { level: 3, name: "User", description: "Say a saved phrase in your own takes.",
      criteria: [{ kind: "phraseUses", label: "A saved phrase spotted in 3 takes", takes: 3 }], practise: [expression] },
    { level: 4, name: "Range", description: "Use several different saved phrases.",
      criteria: [{ kind: "phraseUses", label: "5 different saved phrases spotted in your takes", distinctPhrases: 5 }], practise: [expression] },
    { level: 5, name: "Natural use", description: "Use them when you haven't prepared.",
      criteria: [{ kind: "phraseUses", label: "3 different saved phrases used in unfamiliar answers", distinctPhrases: 3, unfamiliarOnly: true }], practise: [prompts] },
  ],
  listening: [
    { level: 1, name: "First echo", description: "Imitate a model clip.",
      criteria: [{ kind: "sessions", label: "1 imitation session", filter: { exercise: ["imitate"] }, atLeast: 1 }], practise: [imitate] },
    { level: 2, name: "Three features", description: "Imitate emphasis, rhythm and endings.",
      criteria: [{ kind: "sessions", label: "Imitate emphasis, rhythm and endings", filter: { exercise: ["imitate"], focusIn: IMITATION_FEATURES }, atLeast: 3, distinct: "focus" }], practise: [imitate] },
    { level: 3, name: "Regular", description: "Make imitation a habit.",
      criteria: [{ kind: "sessions", label: "5 imitation sessions on 3 days", filter: { exercise: ["imitate"] }, atLeast: 5, distinctDays: 3 }], practise: [imitate] },
    { level: 4, name: "Shadowing", description: "Three takes of the same clip.",
      criteria: [{ kind: "sessions", label: "3 imitation sessions with three takes or more", filter: { exercise: ["imitate"], minTakes: 3 }, atLeast: 3 }], practise: [imitate] },
    { level: 5, name: "Upgrade", description: "Learn from models over weeks.",
      criteria: [{ kind: "anyOf", label: "10 imitation sessions on 5 days, or 3 upgrade loops", options: [
        { kind: "activity", label: "3 upgrade loops", type: "upgrade", atLeast: 3 },
        { kind: "sessions", label: "10 imitation sessions on 5 days", filter: { exercise: ["imitate"] }, atLeast: 10, distinctDays: 5 },
      ] }], practise: [imitate, upgrade] },
  ],
  storytelling: [
    { level: 1, name: "First story", description: "Tell a story from a storytelling prompt.",
      criteria: [{ kind: "sessions", label: "1 storytelling prompt", filter: { promptTags: ["storytelling"] }, atLeast: 1 }], practise: [storyPrompts] },
    { level: 2, name: "Story spine", description: "Tell stories in order: start, turn, end.",
      criteria: [{ kind: "anyOf", label: "3 storytelling prompts on 2 days", options: [
        { kind: "activity", label: "2 story spine rounds", type: "story_spine", atLeast: 2 },
        { kind: "sessions", label: "3 storytelling prompts on 2 days", filter: { promptTags: ["storytelling"] }, atLeast: 3, distinctDays: 2 },
      ] }], practise: [storyPrompts, drill("Story spine")] },
    { level: 3, name: "Concrete detail", description: "Give the listener something to picture.",
      criteria: [{ kind: "takes", label: "3 takes of a minute or more where you noted a concrete detail", filter: { minSpeechMs: MIN, check: { id: "concrete_detail", value: true } }, atLeast: 3, distinctDays: 2 }],
      practise: [drill("Story spine")] },
    { level: 4, name: "On the spot", description: "Make up a story from random pictures.",
      criteria: [{ kind: "activity", label: "3 rounds of story cubes, on 2 days", type: "story_cubes", atLeast: 3, distinctDays: 2 }], practise: [drill("Story cubes")] },
    { level: 5, name: "Told for real", description: "Tell a story to real people.",
      criteria: [{ kind: "transfers", label: "Tell a story in 2 real conversations and note it", tags: ["story"], atLeast: 2 }], practise: [real] },
  ],
  courage: [
    { level: 1, name: "First reflection", description: "Note a real conversation.",
      criteria: [{ kind: "transfers", label: "1 real-conversation reflection", atLeast: 1 }], practise: [real] },
    { level: 2, name: "Regular", description: "Bring practice into real life every week or so.",
      criteria: [{ kind: "transfers", label: "3 reflections in 3 different weeks", atLeast: 3, distinctWeeks: 3 }], practise: [real] },
    { level: 3, name: "Stepping up", description: "Take small steps that stretch you.",
      criteria: [{ kind: "anyOf", label: "5 real-conversation reflections", options: [
        { kind: "exposure", label: "3 steps of your exposure ladder", steps: 3 },
        { kind: "transfers", label: "3 missions", mission: true, atLeast: 3 },
        { kind: "transfers", label: "5 real-conversation reflections", atLeast: 5 },
      ] }], practise: [real, ladder] },
    { level: 4, name: "Stretch", description: "Do one thing that felt like a real stretch.",
      criteria: [{ kind: "anyOf", label: "Do one thing that felt like a real stretch", options: [
        { kind: "exposure", label: "A ladder step you rated 6 or more before", steps: 1, minBefore: 6 },
        { kind: "activity", label: "A boss level", type: "boss", atLeast: 1 },
        { kind: "conversation", label: "A pressured practice conversation of 6 turns", minTurns: 6, minPressure: 2, atLeast: 1 },
      ] }], practise: [ladder, bosses, partner] },
    { level: 5, name: "Event", description: "Prepare for a real event and look back on it.",
      criteria: [{ kind: "anyOf", label: "10 reflections in 6 different weeks, or an event with its debrief", options: [
        { kind: "debrief", label: "An event with its debrief", atLeast: 1 },
        { kind: "transfers", label: "10 reflections in 6 different weeks", atLeast: 10, distinctWeeks: 6 },
      ] }], practise: [real] },
  ],
};

/** Practise links for features that exist now. */
export const available = (link: PractiseLink) => !link.arrives;
export const areaDef = (id: AreaId) => AREAS.find((a) => a.id === id)!;
