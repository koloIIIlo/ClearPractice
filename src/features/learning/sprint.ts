import type { NavigateFunction } from "react-router";
import { startSequence, stepUrl } from "@/features/practice/sequence";
import { areaDef } from "@/lib/engagement/skills";
import type { AreaId } from "@/lib/engagement/types";
import { buildSprint, mixedSet } from "@/lib/learning/interleave";
import { toLocalDate } from "@/lib/phrase-schedule";

/** Starts the weakest-area sprint (11.8) as a sequence: two or three short steps toward the area's next level. */
export function startSprint(navigate: NavigateFunction, area: AreaId, current: number, { replace = false }: { replace?: boolean } = {}) {
  const today = toLocalDate(new Date());
  const state = startSequence(today, "short", buildSprint(area, current), `${areaDef(area).short} sprint`);
  navigate(stepUrl(state.steps[0], today), { replace, state: { section: "today" } });
}

/** Starts a mixed set (11.3): three different short drills in a row, chosen by the date. */
export function startMixedSet(navigate: NavigateFunction) {
  const today = toLocalDate(new Date());
  const state = startSequence(today, "short", mixedSet(today), "Mixed set");
  navigate(stepUrl(state.steps[0], today), { state: { section: "exercises" } });
}
