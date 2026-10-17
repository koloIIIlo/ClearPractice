import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIpc } from "@/lib/ipc";
import { keys, usePracticeEvents, usePracticeFacts, usePreferences, usePrompts } from "@/lib/ipc/queries";
import type { EngagementState, PracticeEvent, PracticeFacts, QuestRow } from "@/lib/ipc/schemas";
import { toLocalDate } from "@/lib/phrase-schedule";
import { stageForDays } from "@/lib/engagement/companion";
import { evalContext, type EvalContext } from "@/lib/engagement/criteria";
import { evaluateAreas, nearestNext } from "@/lib/engagement/evaluate";
import { questProgress, questReason, questTemplate } from "@/lib/engagement/quests";
import { bests } from "@/lib/engagement/records";
import type { AreaStatus } from "@/lib/engagement/types";
import { allPracticeDays, goalProgress, weekStart, weeksInARow } from "@/lib/engagement/weekly";
import { lifetimeXp, weekXp, xpByWeek } from "@/lib/engagement/xp";

export type QuestView = QuestRow & { title: string; reason: string; done: number; needed: number; met: boolean };
export type Journey = {
  today: string;
  week: string;
  facts: PracticeFacts;
  events: PracticeEvent[];
  state: EngagementState;
  ctx: EvalContext;
  areas: AreaStatus[];
  goal: { days: number; goal: number; met: boolean; weeksInARow: number };
  xp: { week: number; lifetime: number; byWeek: { week: string; xp: number }[] };
  quests: QuestView[];
  swapsLeft: number;
  next: ReturnType<typeof nearestNext>;
  practiceDays: number;
  practiceDaysThisMonth: number;
  stage: number;
  records: ReturnType<typeof bests>;
};

/**
 * Everything the Journey, the Today strip and Today you earned show, from one
 * set of queries the engagement provider keeps fresh (roadmap 9.1, 9.14).
 */
export function useJourney() {
  const ipc = useIpc();
  const { preferences } = usePreferences();
  const today = toLocalDate(new Date());
  const week = weekStart(today, preferences.weekStartsOn);
  const facts = usePracticeFacts();
  const events = usePracticeEvents();
  const state = useQuery({ queryKey: keys.engagementState(week), queryFn: () => ipc.getEngagementState(week) });
  const prompts = usePrompts();

  const journey = useMemo((): Journey | null => {
    if (!facts.data || !events.data || !state.data) return null;
    const ctx = evalContext(facts.data, today, prompts.data ?? []);
    const areas = evaluateAreas(facts.data, state.data.levels, ctx);
    const goal = goalProgress(events.data, week, preferences.weeklyGoalDays);
    const thisWeek = state.data.quests.filter((q) => q.week === week).sort((a, b) => a.slot - b.slot);
    const days = allPracticeDays(events.data);
    return {
      today, week, facts: facts.data, events: events.data, state: state.data, ctx, areas,
      goal: { ...goal, weeksInARow: weeksInARow(state.data.goalWeeks, week, goal.met) },
      xp: { week: weekXp(events.data, week), lifetime: lifetimeXp(events.data), byWeek: xpByWeek(events.data, today, 12, preferences.weekStartsOn) },
      quests: thisWeek.map((q) => ({ ...q, title: questTemplate(q.quest)?.title ?? q.quest, reason: questReason(q), ...questProgress(q, facts.data!, events.data!, ctx) })),
      swapsLeft: thisWeek.some((q) => q.swapped) ? 0 : 1,
      next: nearestNext(areas),
      practiceDays: days.length,
      practiceDaysThisMonth: days.filter((d) => d.slice(0, 7) === today.slice(0, 7)).length,
      stage: stageForDays(days.length),
      records: bests(state.data.records),
    };
  }, [facts.data, events.data, state.data, prompts.data, today, week, preferences.weeklyGoalDays, preferences.weekStartsOn]);

  const error = facts.error ?? events.error ?? state.error;
  return {
    journey,
    isPending: !journey && !error,
    error,
    refetch: () => Promise.all([facts.refetch(), events.refetch(), state.refetch()]),
  };
}
