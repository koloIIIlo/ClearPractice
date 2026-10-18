import type { NavItem } from "./nav";

/**
 * Page code loaded ahead of a visit (roadmap 7.1): on hovering or focusing a
 * sidebar entry, and once Today is idle for the pages most likely next. The
 * module cache makes repeated calls free.
 */
export type PrefetchId = Exclude<NavItem["id"], "today"> | "studio" | "done";

export const ROUTE_MODULES: Record<PrefetchId, () => Promise<unknown>> = {
  exercises: () => import("@/features/exercises/ExercisesPage"),
  sessions: () => import("@/features/sessions/SessionsPage"),
  phrases: () => import("@/features/phrases/PhrasesPage"),
  confidence: () => import("@/features/confidence/ConfidencePage"),
  progress: () => import("@/features/progress/ProgressPage"),
  journey: () => import("@/features/journey/JourneyPage"),
  settings: () => import("@/features/settings/SettingsPage"),
  studio: () => import("@/features/practice/StudioPage"),
  done: () => import("@/features/practice/CompletionPage"),
};

/** Starts loading a page's code; failures are ignored (the visit itself loads it again). */
export function prefetchRoute(id: NavItem["id"] | PrefetchId): void {
  if (id === "today") return;
  void ROUTE_MODULES[id]().catch(() => {});
}

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (handle: number) => void };

/** Warms the given pages when the window is idle (or after 1.5 s); returns a cancel function. */
export function prefetchWhenIdle(ids: PrefetchId[]): () => void {
  const w = window as IdleWindow;
  const run = () => ids.forEach(prefetchRoute);
  if (w.requestIdleCallback) {
    const handle = w.requestIdleCallback(run);
    return () => w.cancelIdleCallback?.(handle);
  }
  const timer = setTimeout(run, 1500);
  return () => clearTimeout(timer);
}
