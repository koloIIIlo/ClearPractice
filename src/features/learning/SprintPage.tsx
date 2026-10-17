import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, LoadingBlock, Page } from "@/components/page";
import { useIpc } from "@/lib/ipc";
import { keys, usePracticeFacts, usePreferences, usePrompts } from "@/lib/ipc/queries";
import { evalContext } from "@/lib/engagement/criteria";
import { areaActivity } from "@/lib/engagement/quests";
import { AREAS } from "@/lib/engagement/skills";
import type { AreaId } from "@/lib/engagement/types";
import { weekStart } from "@/lib/engagement/weekly";
import { weakestArea } from "@/lib/learning/interleave";
import { toLocalDate } from "@/lib/phrase-schedule";
import { startSprint } from "./sprint";

/**
 * /sprint (Ctrl+K "Sprint on my weakest area", 11.8): finds the area with the
 * lowest level, ties broken by the least practice in 30 days, and starts its
 * sprint. ?area= picks the area instead.
 */
export function SprintPage() {
  const ipc = useIpc();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const facts = usePracticeFacts();
  const prompts = usePrompts();
  const { preferences } = usePreferences();
  const today = toLocalDate(new Date());
  const week = weekStart(today, preferences.weekStartsOn);
  const state = useQuery({ queryKey: keys.engagementState(week), queryFn: () => ipc.getEngagementState(week) });
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !facts.data || !state.data || !prompts.data) return;
    started.current = true;
    const reached = new Map<AreaId, number>();
    for (const l of state.data.levels) reached.set(l.area as AreaId, Math.max(reached.get(l.area as AreaId) ?? 0, l.level));
    const areas = AREAS.map((a) => ({ area: a.id, current: (reached.get(a.id) ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 }));
    const asked = params.get("area");
    const area = AREAS.some((a) => a.id === asked) ? (asked as AreaId) : weakestArea(areas, areaActivity(facts.data, today, evalContext(facts.data, today, prompts.data)));
    startSprint(navigate, area, reached.get(area) ?? 0, { replace: true });
  }, [facts.data, state.data, prompts.data, params, navigate, today]);
  const error = facts.error ?? state.error ?? prompts.error;
  return <Page className="max-w-3xl">{error ? <ErrorState error={error} title="The sprint couldn't be prepared" /> : <LoadingBlock rows={2} label="Preparing your sprint" />}</Page>;
}
