import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useIpc } from "@/lib/ipc";
import { usePreferences } from "@/lib/ipc/queries";
import type { EngagementState, PracticeEvent, Preferences, UnlockOutcome } from "@/lib/ipc/schemas";
import { toLocalDate } from "@/lib/phrase-schedule";
import { allPracticeDays, goalProgress, weekStart, weeksInARow } from "@/lib/engagement/weekly";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { celebrationQueue } from "./queue";
import { onEngagementRefresh, type RefreshReason } from "./refresh";
import { effectiveStyle } from "./style";

/**
 * The refresh loop of the game layer (roadmap 9.4, D-31): after anything that
 * could change it, read the facts, events and state, evaluate, record what is
 * new once (with its XP, natively), refresh the views and queue celebrations.
 * It runs in Calm style too, so nothing is lost; only celebrations are off.
 * Errors never reach you: the game layer must never block practice.
 */
export type EngagementApi = { refresh: (reason: RefreshReason) => void; lastOutcome: UnlockOutcome | null };

const EngagementContext = createContext<EngagementApi>({ refresh: () => {}, lastOutcome: null });
export const useEngagement = () => useContext(EngagementContext);

const DEBOUNCE_MS = 400;

export function EngagementProvider({ children }: { children: ReactNode }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const { preferences, loaded } = usePreferences();
  const reducedMotion = useReducedMotion();
  const prefs = useRef<Preferences>(preferences);
  prefs.current = preferences;
  const reduced = useRef(reducedMotion);
  reduced.current = reducedMotion;
  const [lastOutcome, setLastOutcome] = useState<UnlockOutcome | null>(null);
  const loop = useRef({ timer: undefined as ReturnType<typeof setTimeout> | undefined, running: false, queued: null as RefreshReason | null, stage: null as number | null });

  const run = useCallback(async (reason: RefreshReason) => {
    const p = prefs.current;
    const today = toLocalDate(new Date());
    const week = weekStart(today, p.weekStartsOn);
    const [engine, facts, events, initial, prompts] = await Promise.all([import("./engine"), ipc.getPracticeFacts(), ipc.listPracticeEvents(), ipc.getEngagementState(week), ipc.listPrompts().catch(() => [])]);
    const { celebrationsFrom, evalContext, evaluate, evaluateAreas, generateWeeklyQuests, isEmptyDiff, limitBatch, stageForDays } = engine;
    const ctx = evalContext(facts, today, prompts);
    let state: EngagementState = initial;
    // This week's quests, chosen and frozen the first time the week is seen (9.9).
    if (!state.quests.some((q) => q.week === week)) {
      const areas = evaluateAreas(facts, state.levels, ctx);
      const rows = await ipc.setWeeklyQuests(week, generateWeeklyQuests(facts, areas, events, week, state.quests, ctx));
      state = { ...state, quests: [...state.quests.filter((q) => q.week !== week), ...rows] };
    }
    const diff = evaluate(facts, events, state, p, ctx);
    const outcome = isEmptyDiff(diff) ? null : await ipc.recordUnlocks({ ...diff, localDate: today });
    const stage = stageForDays(allPracticeDays(events).length);
    const grew = loop.current.stage !== null && stage > loop.current.stage;
    loop.current.stage = stage;
    if (outcome) setLastOutcome(outcome);
    await qc.invalidateQueries({ queryKey: ["engagement"] });
    const style = effectiveStyle(p, reduced.current);
    if (reason === "start" || !style.playful || style.celebrations === "off") return;
    const goal = goalProgress(events, week, p.weeklyGoalDays);
    const items = celebrationsFrom(outcome ?? { levels: [], achievements: [], records: [], questsDone: [], weeklyGoal: null, xp: 0 }, {
      goal: { ...goal, weeksInARow: weeksInARow(state.goalWeeks, week, true) },
      companionGrew: grew && p.companion,
      history: state.records,
    });
    celebrationQueue.enqueue(limitBatch(items));
  }, [ipc, qc]);

  const pump = useCallback(async () => {
    const l = loop.current;
    if (l.running || l.queued === null) return;
    const reason = l.queued;
    l.queued = null;
    l.running = true;
    try {
      await run(reason);
    } catch {
      // The game layer never blocks practice: a failed refresh is simply tried again on the next change.
    } finally {
      l.running = false;
      if (l.queued !== null) void pump();
    }
  }, [run]);

  const refresh = useCallback((reason: RefreshReason) => {
    const l = loop.current;
    // Anything but "start" wins, so a real change still celebrates.
    l.queued = l.queued === null || l.queued === "start" ? reason : l.queued;
    clearTimeout(l.timer);
    l.timer = setTimeout(() => void pump(), DEBOUNCE_MS);
  }, [pump]);

  // Once preferences are known (the week's first day depends on them).
  useEffect(() => {
    if (loaded) refresh("start");
  }, [loaded, refresh]);
  useEffect(() => onEngagementRefresh(refresh), [refresh]);
  // Tagged mutations (meta.engagement) refresh after they succeed.
  useEffect(
    () =>
      qc.getMutationCache().subscribe((event) => {
        if (event.type !== "updated" || event.action.type !== "success") return;
        const tag = event.mutation.options.meta?.engagement;
        if (typeof tag === "string") refresh(tag as RefreshReason);
      }),
    [qc, refresh],
  );
  useEffect(() => () => clearTimeout(loop.current.timer), []);

  const api = useMemo(() => ({ refresh, lastOutcome }), [refresh, lastOutcome]);
  return <EngagementContext.Provider value={api}>{children}</EngagementContext.Provider>;
}

/** Today's XP events and unlocks, for Today you earned. */
export function earnedToday(events: readonly PracticeEvent[], state: EngagementState | undefined, today: string) {
  const isToday = (iso: string) => toLocalDate(new Date(iso)) === today;
  return {
    xp: events.filter((e) => e.localDate === today).reduce((n, e) => n + e.xp, 0),
    levels: state?.levels.filter((l) => isToday(l.achievedAt)) ?? [],
    achievements: state?.achievements.filter((a) => isToday(a.unlockedAt)) ?? [],
    records: state?.records.filter((r) => r.previous !== null && isToday(r.achievedAt)) ?? [],
  };
}
