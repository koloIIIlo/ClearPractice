import { themeFor } from "@/content/monthly-themes";
import { addLocalDays } from "@/lib/phrase-schedule";
import type { FactSession, PracticeEvent, PracticeFacts, QuestInput, QuestRow } from "@/lib/ipc/schemas";
import type { EvalContext } from "./criteria";
import { inWeek, speechMs } from "./criteria";
import { seededRandom } from "./random";
import { areaDef } from "./skills";
import type { AreaId, AreaStatus } from "./types";

/**
 * Three small, varied goals each week with one swap (roadmap 9.9, appendix
 * B.5). Generation is deterministic for a week, and the week is stored when
 * first shown, so later changes never reshuffle it.
 */
export type QuestTemplate = {
  id: string;
  title: string;
  area: AreaId;
  needed: number;
  /** False while the feature it needs isn't available. */
  needs: (facts: PracticeFacts) => boolean;
  /** This week's count. */
  count: (week: Week) => number;
};
type Week = { facts: PracticeFacts; events: readonly PracticeEvent[]; start: string; ctx: EvalContext; sessions: FactSession[] };

const always = () => true;
const sessionsWith = (w: Week, test: (s: FactSession) => boolean) => w.sessions.filter((s) => s.takeCount > 0 && test(s)).length;
const takesWith = (w: Week, test: (t: PracticeFacts["takes"][number], s: FactSession | undefined) => boolean) => {
  const byId = new Map(w.facts.sessions.map((s) => [s.id, s]));
  return w.facts.takes.filter((t) => inWeek(t.localDate, w.start) && test(t, byId.get(t.sessionId))).length;
};

export const QUEST_TEMPLATES: readonly QuestTemplate[] = [
  { id: "unfamiliar-2", title: "Answer 2 unfamiliar questions", area: "spontaneity", needed: 2, needs: always, count: (w) => sessionsWith(w, (s) => s.familiarity === "unfamiliar") },
  { id: "real-1", title: "Have one real conversation and note it", area: "courage", needed: 1, needs: always,
    count: (w) => w.facts.transferReviews.filter((r) => inWeek(r.localDate, w.start)).length },
  { id: "retake-3", title: "Record a second take in 3 sessions", area: "fluency", needed: 3, needs: always, count: (w) => sessionsWith(w, (s) => s.takeCount >= 2) },
  { id: "review-2", title: "Review the candidates in 2 takes", area: "fluency", needed: 2,
    needs: (f) => f.transcriptionAvailable || f.takes.some((t) => t.transcribed),
    count: (w) => w.events.filter((e) => e.kind === "transcript_reviewed" && inWeek(e.localDate, w.start)).length },
  { id: "phrases-10", title: "Review 10 phrases", area: "vocabulary", needed: 10, needs: always,
    count: (w) => w.facts.phraseReviews.filter((r) => inWeek(r.localDate, w.start)).length },
  { id: "phrase-use-1", title: "Use a saved phrase in a take", area: "vocabulary", needed: 1, needs: (f) => f.phrases.some((p) => !p.deleted),
    count: (w) => takesWith(w, (t) => t.phraseIds.length > 0) },
  { id: "imitate-1", title: "Imitate a clip", area: "listening", needed: 1, needs: always, count: (w) => sessionsWith(w, (s) => s.exerciseType === "imitate") },
  { id: "story-1", title: "Tell a story", area: "storytelling", needed: 1, needs: always,
    count: (w) => sessionsWith(w, (s) => !!s.contentId && (w.ctx.promptTags[s.contentId] ?? []).includes("storytelling")) },
  { id: "no-notes-1", title: "Speak for a minute without notes", area: "structure", needed: 1, needs: always,
    count: (w) => takesWith(w, (t, s) => !!s && !s.outline.some(Boolean) && speechMs(t) >= 60_000) },
  { id: "intonation-2", title: "Look at the intonation of 2 takes", area: "voice", needed: 2, needs: always, count: (w) => takesWith(w, (t) => t.prosodyViewed) },
  { id: "point-first-2", title: "Note \"point first\" on 2 takes", area: "structure", needed: 2, needs: always, count: (w) => takesWith(w, (t) => t.checks.point_first === true) },
];

export const questTemplate = (id: string) => QUEST_TEMPLATES.find((q) => q.id === id);

function week(facts: PracticeFacts, events: readonly PracticeEvent[], start: string, ctx: EvalContext): Week {
  return { facts, events, start, ctx, sessions: facts.sessions.filter((s) => inWeek(s.localDate, start)) };
}

export function questProgress(q: Pick<QuestRow, "quest" | "week">, facts: PracticeFacts, events: readonly PracticeEvent[], ctx: EvalContext): { done: number; needed: number; met: boolean } {
  const template = questTemplate(q.quest);
  if (!template) return { done: 0, needed: 1, met: false };
  const done = template.count(week(facts, events, q.week, ctx));
  return { done: Math.min(done, template.needed), needed: template.needed, met: done >= template.needed };
}

/** How much each area was practised in the last 30 days (a simple, visible count). */
export function areaActivity(facts: PracticeFacts, today: string, ctx: EvalContext): Record<AreaId, number> {
  const since = addLocalDays(today, -30);
  const sessions = facts.sessions.filter((s) => s.localDate > since && s.takeCount > 0);
  const takes = facts.takes.filter((t) => t.localDate > since);
  return {
    structure: sessions.filter((s) => s.outline[0]).length + takes.filter((t) => t.checks.point_first !== undefined || t.checks.clear_ending !== undefined).length,
    fluency: takes.filter((t) => t.fillersReviewed).length,
    voice: takes.filter((t) => t.prosodyViewed).length,
    spontaneity: sessions.filter((s) => s.familiarity === "unfamiliar").length,
    vocabulary: facts.phraseReviews.filter((r) => r.localDate > since).length + takes.filter((t) => t.phraseIds.length > 0).length,
    listening: sessions.filter((s) => s.exerciseType === "imitate").length,
    storytelling: sessions.filter((s) => !!s.contentId && (ctx.promptTags[s.contentId] ?? []).includes("storytelling")).length,
    courage: facts.transferReviews.filter((r) => r.localDate > since).length,
  };
}

/** Why a slot holds its quest, from its stored params. */
export function questReason(q: Pick<QuestRow, "slot" | "params" | "quest">): string {
  const params = (q.params ?? {}) as { area?: AreaId; theme?: AreaId };
  if (q.slot === 1 && params.area) return `${areaDef(params.area).title} has had the least practice this month.`;
  if (q.slot === 2) return "Practice counts most when it reaches real people.";
  if (params.theme) return `For variety, and this month's theme: ${areaDef(params.theme).title}.`;
  return "For variety: something you haven't done as a quest lately.";
}

/**
 * This week's three quests: your least-practised area, the real world, and
 * variety (a template not used in the last three weeks, leaning toward the
 * month's theme). Deterministic for a week.
 */
export function generateWeeklyQuests(
  facts: PracticeFacts, areas: readonly AreaStatus[], _events: readonly PracticeEvent[], start: string, recent: readonly QuestRow[], ctx: EvalContext,
): QuestInput[] {
  const random = seededRandom(`quests-${start}`);
  const usable = QUEST_TEMPLATES.filter((t) => t.needs(facts));
  const activity = areaActivity(facts, ctx.today, ctx);
  const ranked = [...areas].sort((a, b) => a.current - b.current || activity[a.area] - activity[b.area] || a.area.localeCompare(b.area));
  const pick = (list: readonly QuestTemplate[]) => list[Math.floor(random() * list.length)];

  const weakest = ranked.find((a) => usable.some((t) => t.area === a.area && t.id !== "real-1")) ?? ranked[0];
  const first = pick(usable.filter((t) => t.area === weakest.area && t.id !== "real-1")) ?? usable.find((t) => t.id !== "real-1")!;
  const second = usable.find((t) => t.id === "real-1")!;
  const lately = new Set(recent.filter((q) => q.week < start && q.week >= addLocalDays(start, -21)).map((q) => q.quest));
  const fresh = usable.filter((t) => t.id !== first.id && t.id !== second.id && !lately.has(t.id));
  const theme = themeFor(start).area;
  const themed = fresh.filter((t) => t.area === theme);
  const third = pick(themed.length > 0 ? themed : fresh.length > 0 ? fresh : usable.filter((t) => t.id !== first.id && t.id !== second.id));
  return [
    { slot: 1, quest: first.id, params: { area: weakest.area } },
    { slot: 2, quest: second.id, params: {} },
    { slot: 3, quest: third.id, params: themed.includes(third) ? { theme } : {} },
  ];
}

/** The next eligible template for a swap: not in this week, not done lately. */
export function swapCandidate(slot: number, current: readonly QuestRow[], facts: PracticeFacts, recent: readonly QuestRow[], start: string): QuestInput | null {
  const taken = new Set(current.map((q) => q.quest));
  const lately = new Set(recent.filter((q) => q.week < start && q.week >= addLocalDays(start, -21)).map((q) => q.quest));
  const candidates = QUEST_TEMPLATES.filter((t) => t.needs(facts) && !taken.has(t.id));
  const choice = candidates.find((t) => !lately.has(t.id)) ?? candidates[0];
  return choice ? { slot, quest: choice.id, params: {} } : null;
}
