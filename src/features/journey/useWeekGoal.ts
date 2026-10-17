import { useQuery } from "@tanstack/react-query";
import { useIpc } from "@/lib/ipc";
import { keys, usePracticeEvents, usePreferences } from "@/lib/ipc/queries";
import { toLocalDate } from "@/lib/phrase-schedule";
import { goalProgress, weekStart, weeksInARow } from "@/lib/engagement/weekly";

/**
 * This week's goal for the week row (roadmap 9.8), from the events and the
 * goal weeks alone, so Today doesn't load the evaluation engine for it.
 */
export function useWeekGoal(enabled: boolean) {
  const ipc = useIpc();
  const { preferences } = usePreferences();
  const week = weekStart(toLocalDate(new Date()), preferences.weekStartsOn);
  const events = usePracticeEvents();
  const state = useQuery({ queryKey: keys.engagementState(week), queryFn: () => ipc.getEngagementState(week), enabled });
  if (!enabled || !events.data || !state.data) return null;
  const goal = goalProgress(events.data, week, preferences.weeklyGoalDays);
  return { ...goal, weeksInARow: weeksInARow(state.data.goalWeeks, week, goal.met) };
}
