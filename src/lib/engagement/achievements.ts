import {
  Award, BookOpenText, Calendar, CalendarCheck, CalendarHeart, Ear, EyeOff, FileText, Flag, Footprints, Gem, Hourglass, ListOrdered, MessageSquareQuote,
  Mic, Milestone, NotebookPen, PenLine, Repeat, Search, Sparkles, Sprout, Sunrise, Target, Trophy, Waves, Zap, Bomb, CalendarDays, Crown, Dices, Gauge, Highlighter,
  Shapes, Swords, Timer, MessagesSquare, Flame, ArrowUpCircle, type LucideIcon,
} from "lucide-react";
import { BOSSES, type BossId } from "@/content/bosses";
import { DRILL_TYPES } from "@/lib/ipc/schemas";
import { profileReadiness } from "@/lib/insights/profile";
import type { EngagementState, NewAchievement, PracticeEvent, PracticeFacts, Preferences } from "@/lib/ipc/schemas";
import { finishedConversations, progressOf, type Criterion, type EvalContext } from "./criteria";
import { LEVELS } from "./skills";
import type { AreaStatus, CriterionProgress } from "./types";
import { allPracticeDays, goalProgress, weekStart, weeksInARow } from "./weekly";
import { drillPlays, drillTypesPlayed } from "./drills";
import { addLocalDays } from "@/lib/phrase-schedule";

/**
 * Achievements (roadmap 9.6, appendix B.2): firsts, habits, craft, courage,
 * exploring, phrases and listening. All visible, none hidden, so they are
 * goals as well as rewards. Achievements of later milestones join with them.
 */
export const ACHIEVEMENTS_VERSION = 1;

export type AccentId = "green" | "ocean" | "amber" | "violet" | "rose" | "graphite";
export type PotId = "clay" | "white" | "blue" | "wood" | "stone";
export type AchievementCategory = "start" | "habit" | "craft" | "courage" | "explore" | "phrases" | "listening" | "real";

/** What a custom check sees. */
export type AchievementInput = { facts: PracticeFacts; state: EngagementState; events: readonly PracticeEvent[]; ctx: EvalContext; areas: readonly AreaStatus[]; prefs: Pick<Preferences, "weekStartsOn" | "weeklyGoalDays"> };
type Custom = { kind: "custom"; label: string; test: (input: AchievementInput) => { done: number; needed: number } };

export type AchievementDef = {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  icon: LucideIcon;
  criterion: Criterion | Custom;
  unlocksAccent?: AccentId;
  unlocksPot?: PotId;
};

export const CATEGORY_TITLES: Record<AchievementCategory, string> = {
  start: "Getting started", habit: "Habit", craft: "Craft", courage: "Courage", explore: "Explore", phrases: "Phrases", listening: "Listening", real: "Real world",
};

const custom = (label: string, test: Custom["test"]): Custom => ({ kind: "custom", label, test });
const count = (n: number, needed: number) => ({ done: n, needed });
const events = (kind: string) => ({ events }: AchievementInput) => events.filter((e) => e.kind === kind).length;
const CORE = new Set<string>(["repeat", "thought_groups", "imitate", "expression"]);
/** A boss level finished: every round recorded (10.13). */
/** A boss level finished: every round recorded (10.13), or played with the partner and ended after three answers (13.6). */
const boss = (id: string, title: string, description: string, bossId: BossId): AchievementDef => ({
  id, title, description, category: "courage", icon: Crown,
  criterion: custom(`Finish ${BOSSES.find((b) => b.id === bossId)!.title}`, ({ facts }) =>
    count(
      drillPlays(facts, "boss").some((p) => p.result.finished === 1 && p.session.activity?.params.boss === bossId) ||
        finishedConversations(facts, 3).some((c) => c.bossId === bossId)
        ? 1
        : 0,
      1,
    )),
});

/** Weeks in a row as of now, this week counting once met. */
function streak({ state, events, ctx, prefs }: AchievementInput): number {
  const week = weekStart(ctx.today, prefs.weekStartsOn);
  return weeksInARow(state.goalWeeks, week, goalProgress(events, week, prefs.weeklyGoalDays).met);
}

const MIN = 60_000;
const levelCriterion = (area: keyof typeof LEVELS, level: number) => LEVELS[area][level - 1].criteria[0];

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // Getting started
  { id: "first-take", title: "First take", description: "Save your first take.", category: "start", icon: Mic,
    criterion: { kind: "takes", label: "1 saved take", filter: {}, atLeast: 1 } },
  { id: "first-session", title: "First session", description: "Finish a practice sequence.", category: "start", icon: Flag,
    criterion: custom("Finish a practice sequence", (i) => count(events("sequence_completed")(i), 1)) },
  { id: "baseline", title: "Starting point", description: "Record your baseline answer.", category: "start", icon: Milestone,
    criterion: custom("Record your baseline answer", (i) => count(events("baseline_saved")(i), 1)) },
  { id: "first-transcript", title: "In writing", description: "Transcribe a take.", category: "start", icon: FileText,
    criterion: { kind: "takes", label: "1 transcribed take", filter: { transcribed: true }, atLeast: 1 } },
  { id: "first-review", title: "Noticed", description: "Review the hesitation candidates in a take.", category: "start", icon: Search,
    criterion: { kind: "takes", label: "1 reviewed take", filter: { fillersReviewed: true }, atLeast: 1 } },
  { id: "first-phrase", title: "Keeper", description: "Save your first phrase.", category: "start", icon: BookOpenText,
    criterion: { kind: "phrases", label: "1 phrase of your own", saved: 1 } },
  { id: "first-reflection", title: "Out in the world", description: "Note a real conversation.", category: "start", icon: MessageSquareQuote,
    criterion: { kind: "transfers", label: "1 real-conversation reflection", atLeast: 1 }, unlocksAccent: "rose" },
  // Habit
  { id: "goal-1", title: "Week one", description: "Reach your weekly goal.", category: "habit", icon: CalendarCheck,
    criterion: custom("Reach your weekly goal once", (i) => count(i.state.goalWeeks.length, 1)), unlocksAccent: "ocean" },
  { id: "goal-4", title: "Four in a row", description: "Reach your weekly goal four weeks in a row.", category: "habit", icon: Calendar,
    criterion: custom("4 weeks in a row", (i) => count(streak(i), 4)), unlocksPot: "blue" },
  { id: "goal-12", title: "A season of practice", description: "Twelve weeks in a row.", category: "habit", icon: CalendarHeart,
    criterion: custom("12 weeks in a row", (i) => count(streak(i), 12)), unlocksPot: "stone" },
  { id: "days-10", title: "Ten days", description: "Practise on 10 days.", category: "habit", icon: Footprints,
    criterion: custom("10 practice days", (i) => count(allPracticeDays(i.events).length, 10)), unlocksAccent: "amber" },
  { id: "days-30", title: "Thirty days", description: "Practise on 30 days.", category: "habit", icon: Sprout,
    criterion: custom("30 practice days", (i) => count(allPracticeDays(i.events).length, 30)), unlocksAccent: "graphite" },
  { id: "days-100", title: "A hundred days", description: "Practise on 100 days.", category: "habit", icon: Trophy,
    criterion: custom("100 practice days", (i) => count(allPracticeDays(i.events).length, 100)), unlocksPot: "wood" },
  { id: "comeback", title: "Welcome back", description: "Practise again after 14 days or more away.", category: "habit", icon: Sunrise,
    criterion: custom("Practise after a break of 14 days", (i) => {
      const days = allPracticeDays(i.events);
      return count(days.some((d, k) => k > 0 && addLocalDays(days[k - 1], 14) <= d) ? 1 : 0, 1);
    }) },
  { id: "fresh-start", title: "Fresh start", description: "Practise on the first day of a month.", category: "habit", icon: Sparkles,
    criterion: custom("Practise on the 1st of a month", (i) => count(allPracticeDays(i.events).some((d) => d.endsWith("-01")) ? 1 : 0, 1)) },
  // Craft
  { id: "three-takes", title: "Third time", description: "Record three takes in one session.", category: "craft", icon: Repeat,
    criterion: { kind: "sessions", label: "A session with 3 takes", filter: { minTakes: 3 }, atLeast: 1 } },
  { id: "no-notes", title: "Said it without notes", description: "Speak for a minute or more with an empty outline.", category: "craft", icon: PenLine,
    criterion: { kind: "takes", label: "A minute or more with an empty outline", filter: { minSpeechMs: MIN, noOutline: true }, atLeast: 1 } },
  { id: "long-run-15", title: "Long run", description: "Say 15 words or more between pauses.", category: "craft", icon: Waves,
    criterion: { kind: "takes", label: "15 words between pauses", filter: { metric: { key: "longestRun", op: ">=", value: 15 } }, atLeast: 1 } },
  { id: "steady-minute", title: "Steady minute", description: "A minute or more with at most one pause inside a clause.", category: "craft", icon: Hourglass,
    criterion: { kind: "takes", label: "A familiar minute with at most one pause inside a clause", filter: { familiarity: "familiar", minSpeechMs: MIN, metric: { key: "midClausePauses", op: "<=", value: 1 } }, atLeast: 1 } },
  { id: "point-first-5", title: "Straight to the point", description: "Note \"point first\" on 5 takes.", category: "craft", icon: Target,
    criterion: { kind: "takes", label: "5 takes noted as point first", filter: { check: { id: "point_first", value: true } }, atLeast: 5 } },
  { id: "clear-ending-5", title: "Strong finish", description: "Note a clear ending on 5 takes.", category: "craft", icon: ListOrdered,
    criterion: { kind: "takes", label: "5 takes noted with a clear ending", filter: { check: { id: "clear_ending", value: true } }, atLeast: 5 } },
  { id: "profile-ready", title: "Know your voice", description: "Have enough takes for every row of your speech profile.", category: "craft", icon: Gem,
    criterion: custom("Every row of your speech profile", (i) => {
      const { filled, total } = profileReadiness(i.facts);
      return count(filled, total);
    }) },
  // The learning engine (M11).
  { id: "prediction-10", title: "Self-aware", description: "Make 10 predictions before looking.", category: "craft", icon: Target,
    criterion: custom("10 takes with a guess first", ({ facts }) => count(facts.takes.filter((tk) => Object.keys(tk.predictions).length > 0).length, 10)) },
  // Courage
  { id: "unfamiliar-first", title: "Into the unknown", description: "Answer an unfamiliar question.", category: "courage", icon: Zap,
    criterion: { kind: "sessions", label: "1 unfamiliar question", filter: { familiarity: "unfamiliar" }, atLeast: 1 } },
  { id: "no-prep-3", title: "No notice", description: "Answer 3 unfamiliar questions with 10 seconds or less to prepare.", category: "courage", icon: Zap,
    criterion: { kind: "sessions", label: "3 unfamiliar questions with 10 seconds or less", filter: { familiarity: "unfamiliar", maxPrepSeconds: 10 }, atLeast: 3 } },
  { id: "follow-up-3", title: "And then?", description: "Answer follow-up questions in 3 sessions.", category: "courage", icon: MessageSquareQuote,
    criterion: { kind: "sessions", label: "Follow-up questions in 3 sessions", filter: { followUp: true, minTakes: 2 }, atLeast: 3 } },
  { id: "gauntlet-done", title: "Ran the gauntlet", description: "Complete a gauntlet.", category: "courage", icon: Swords,
    criterion: { kind: "activity", label: "A gauntlet with 5 rounds", type: "gauntlet", result: { key: "roundsCompleted", op: ">=", value: 5 }, atLeast: 1 } },
  boss("boss-interview", "Interview ready", "Finish the job interview boss.", "job-interview"),
  boss("boss-qa", "Held the floor", "Finish the sceptical Q&A boss.", "skeptical-qa"),
  boss("boss-toast", "Raise a glass", "Finish the wedding toast boss.", "toast"),
  boss("boss-meeting", "Back on track", "Finish the interrupted meeting boss.", "meeting"),
  // The confidence pack (M12).
  { id: "ladder-3", title: "Three steps up", description: "Complete 3 steps of your exposure ladder.", category: "courage", icon: Footprints,
    criterion: { kind: "exposure", label: "3 steps of your exposure ladder", steps: 3 } },
  { id: "stretch", title: "Stretch", description: "Complete a step you rated 6 or more before.", category: "courage", icon: Flag,
    criterion: { kind: "exposure", label: "A step you rated 6 or more before, done", steps: 1, minBefore: 6 } },
  // Real world
  // The conversation partner (M13).
  { id: "conversation-first", title: "Talking back", description: "Finish a conversation with the partner.", category: "courage", icon: MessagesSquare,
    criterion: { kind: "conversation", label: "1 conversation with 3 answers or more", minTurns: 3, atLeast: 1 } },
  { id: "conversation-pressure", title: "Under pressure", description: "Finish a conversation at pressure 3.", category: "courage", icon: Flame,
    criterion: { kind: "conversation", label: "1 conversation at pressure 3", minTurns: 3, minPressure: 3, atLeast: 1 } },
  { id: "aar", title: "Lessons learned", description: "Write an after-action review.", category: "real", icon: NotebookPen,
    criterion: custom("1 after-action review", ({ facts }) => count(facts.transferReviews.filter((r) => r.kind === "aar").length, 1)) },
  // Explore
  { id: "all-exercises", title: "Well rounded", description: "Try all four exercises.", category: "explore", icon: Award,
    criterion: custom("All four exercises", ({ facts }) => count(new Set(facts.sessions.filter((s) => s.takeCount > 0 && CORE.has(s.exerciseType ?? "")).map((s) => s.exerciseType)).size, 4)) },
  { id: "own-prompt", title: "Your own question", description: "Add a prompt of your own.", category: "explore", icon: NotebookPen,
    criterion: custom("A prompt of your own", ({ facts }) => count(facts.userPrompts, 1)) },
  { id: "jam-first", title: "Just a Minute", description: "Play Just a Minute.", category: "explore", icon: Timer,
    criterion: { kind: "activity", label: "A round of Just a Minute", type: "jam", atLeast: 1 } },
  { id: "jam-45", title: "Clean minute", description: "Reach 45 clean seconds in Just a Minute.", category: "explore", icon: Timer,
    criterion: { kind: "activity", label: "45 clean seconds (Estimated)", type: "jam", result: { key: "cleanSeconds", op: ">=", value: 45 }, atLeast: 1 } },
  { id: "jam-10-rounds", title: "Regular panellist", description: "Play 10 rounds of Just a Minute.", category: "explore", icon: Timer,
    criterion: { kind: "activity", label: "10 rounds of Just a Minute", type: "jam", atLeast: 10 } },
  { id: "word-bomb-all", title: "Defused", description: "Weave in every word in a word bomb round.", category: "explore", icon: Bomb,
    criterion: custom("All three words in one round", ({ facts }) => count(drillPlays(facts, "word_bomb").some((p) => (p.result.shown ?? 0) >= 3 && p.result.woven === p.result.shown) ? 1 : 0, 1)) },
  { id: "pace-three-speeds", title: "Three gears", description: "Find three clearly different speeds in the pace ladder.", category: "explore", icon: Gauge,
    criterion: { kind: "activity", label: "Three clearly different speeds", type: "pace_ladder", result: { key: "distinctSpeeds", op: ">=", value: 3 }, atLeast: 1 } },
  { id: "emphasis-5", title: "Right on the beat", description: "Reach 5 estimated hits in an emphasis game.", category: "explore", icon: Highlighter,
    criterion: { kind: "activity", label: "5 estimated hits in one game", type: "emphasis", result: { key: "estimatedHits", op: ">=", value: 5 }, atLeast: 1 } },
  { id: "daily-7", title: "Seven dailies", description: "Play 7 daily prompts.", category: "explore", icon: CalendarDays,
    criterion: { kind: "activity", label: "7 daily prompts", type: "daily", atLeast: 7 } },
  { id: "daily-30", title: "Thirty dailies", description: "Play 30 daily prompts.", category: "explore", icon: CalendarDays,
    criterion: { kind: "activity", label: "30 daily prompts", type: "daily", atLeast: 30 } },
  { id: "drill-sampler", title: "Sampler", description: "Play 5 different drills.", category: "explore", icon: Dices, unlocksPot: "white",
    criterion: custom("5 different drills", ({ facts }) => count(drillTypesPlayed(facts).size, 5)) },
  { id: "all-drills", title: "Full deck", description: "Play every drill.", category: "explore", icon: Shapes,
    criterion: custom("Every drill", ({ facts }) => count(drillTypesPlayed(facts).size, DRILL_TYPES.length)) },
  // Phrases
  { id: "phrase-in-take", title: "Used it", description: "A saved phrase was spotted in one of your takes.", category: "phrases", icon: BookOpenText,
    criterion: { kind: "phraseUses", label: "A saved phrase in a take", takes: 1 } },
  { id: "phrase-5-used", title: "Five in use", description: "Five different saved phrases spotted in your takes.", category: "phrases", icon: BookOpenText,
    criterion: { kind: "phraseUses", label: "5 different saved phrases in your takes", distinctPhrases: 5 } },
  { id: "phrase-reviews-100", title: "Hundred reviews", description: "Review phrases 100 times.", category: "phrases", icon: Repeat,
    criterion: { kind: "phrases", label: "100 phrase reviews", reviews: 100 } },
  { id: "say-it-10", title: "Out loud", description: "Say 10 phrases aloud during review.", category: "phrases", icon: Mic,
    criterion: custom("10 phrases said aloud", ({ facts }) => {
      const sayIt = new Set(facts.sessions.filter((s) => s.exerciseType === "phrase_say_it").map((s) => s.id));
      return count(facts.takes.filter((tk) => sayIt.has(tk.sessionId)).length, 10);
    }) },
  // Listening
  { id: "imitation-3-features", title: "Good ear", description: "Imitate emphasis, rhythm and endings.", category: "listening", icon: Ear,
    criterion: levelCriterion("listening", 2) },
  { id: "ab-blind", title: "Blind test", description: "Choose between two takes without knowing which is which.", category: "listening", icon: EyeOff,
    criterion: custom("A blind A/B choice", ({ facts }) => count(facts.blindComparisons, 1)) },
  { id: "catch-it", title: "Caught it", description: "Catch 4 or more hesitations in one round of Catch it.", category: "listening", icon: Ear,
    criterion: custom("A round of Catch it with 4 or more caught", ({ facts }) => count(facts.takes.some((tk) => tk.catchRuns.some((r) => r.caught >= 4)) ? 1 : 0, 1)) },
  { id: "upgrade-3", title: "Upgraded", description: "Complete 3 upgrade loops.", category: "listening", icon: ArrowUpCircle,
    criterion: { kind: "activity", label: "3 upgrade loops", type: "upgrade", atLeast: 3 } },
];

/** Progress toward an achievement, with the evidence behind it. */
export function achievementProgress(def: AchievementDef, input: AchievementInput): CriterionProgress {
  if (def.criterion.kind === "custom") {
    const { done, needed } = def.criterion.test(input);
    return { met: done >= needed, done: Math.min(done, needed), needed, label: def.criterion.label, days: null, evidence: [], unavailable: null };
  }
  return progressOf(def.criterion, input.facts, input.ctx);
}

export function newAchievements(
  facts: PracticeFacts, state: EngagementState, events: readonly PracticeEvent[], ctx: EvalContext, areas: readonly AreaStatus[],
  prefs: Pick<Preferences, "weekStartsOn" | "weeklyGoalDays">,
): NewAchievement[] {
  const unlocked = new Set(state.achievements.map((a) => a.id));
  const input: AchievementInput = { facts, state, events, ctx, areas, prefs };
  return ACHIEVEMENTS.filter((def) => !unlocked.has(def.id))
    .map((def) => ({ def, progress: achievementProgress(def, input) }))
    .filter(({ progress }) => progress.met)
    .map(({ def, progress }) => ({ id: def.id, definitionVersion: ACHIEVEMENTS_VERSION, evidence: { ids: progress.evidence.map((e) => e.id) } }));
}
