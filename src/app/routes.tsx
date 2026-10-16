import type { ComponentType } from "react";
import { createHashRouter, type RouteObject } from "react-router";
import { useExercises, useSession } from "@/lib/ipc/queries";
import { TodayPage } from "@/features/today/TodayPage";
import { AppShell } from "./AppShell";
import { RouteError } from "./RouteError";
import type { RouteHandle } from "./TopBar";

function SessionCrumb({ id }: { id: string }) {
  const { data } = useSession(id);
  return <>{data?.title ?? "Session"}</>;
}

function ExerciseCrumb({ id }: { id: string }) {
  const { data } = useExercises();
  return <>{data?.find((e) => e.id === id)?.title ?? "Exercise"}</>;
}

const crumb = (label: string): RouteHandle => ({ crumb: () => label });

/**
 * Loads a page's code on its first visit (roadmap 7.1); the crumb stays static
 * so the breadcrumb never waits. Only Today loads with the app; the Studio and
 * the other pages are prefetched once Today is idle (prefetch.ts).
 */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return async () => ({ Component: (await load())[name] });
}

/**
 * Hash routing keeps navigation local, with no web server (§8).
 * The pathless layout route holds the error boundary so the shell stays usable on failure.
 */
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, element: <TodayPage />, handle: crumb("Today") },
          {
            path: "exercises",
            handle: crumb("Exercises"),
            children: [
              { index: true, lazy: page(() => import("@/features/exercises/ExercisesPage"), "ExercisesPage") },
              {
                path: ":exerciseId",
                lazy: page(() => import("@/features/exercises/ExerciseDetailPage"), "ExerciseDetailPage"),
                handle: { crumb: (p) => <ExerciseCrumb id={p.exerciseId!} /> } satisfies RouteHandle,
              },
            ],
          },
          { path: "practice/done", lazy: page(() => import("@/features/practice/CompletionPage"), "CompletionPage"), handle: crumb("Practice complete") },
          { path: "practice/:exerciseId", lazy: page(() => import("@/features/practice/StudioPage"), "StudioPage"), handle: crumb("Practice studio") },
          {
            path: "sessions",
            handle: crumb("Sessions"),
            children: [
              { index: true, lazy: page(() => import("@/features/sessions/SessionsPage"), "SessionsPage") },
              { path: "trash", lazy: page(() => import("@/features/sessions/TrashPage"), "TrashPage"), handle: crumb("Trash") },
              {
                path: ":sessionId",
                handle: { crumb: (p) => <SessionCrumb id={p.sessionId!} /> } satisfies RouteHandle,
                children: [
                  { index: true, lazy: page(() => import("@/features/review/ReviewPage"), "ReviewPage") },
                  {
                    path: "attempt/:ordinal",
                    lazy: page(() => import("@/features/review/ReviewPage"), "ReviewPage"),
                    handle: { crumb: (p) => `Attempt ${p.ordinal}` } satisfies RouteHandle,
                  },
                  { path: "compare", lazy: page(() => import("@/features/review/ComparePage"), "ComparePage"), handle: crumb("Compare attempts") },
                ],
              },
            ],
          },
          { path: "compare", lazy: page(() => import("@/features/insights/CrossComparePage"), "CrossComparePage"), handle: crumb("Compare takes") },
          { path: "phrases", lazy: page(() => import("@/features/phrases/PhrasesPage"), "PhrasesPage"), handle: crumb("Phrases") },
          { path: "progress", lazy: page(() => import("@/features/progress/ProgressPage"), "ProgressPage"), handle: crumb("Progress") },
          { path: "settings/:section?", lazy: page(() => import("@/features/settings/SettingsPage"), "SettingsPage"), handle: crumb("Settings") },
          { path: "welcome", lazy: page(() => import("@/features/onboarding/WelcomePage"), "WelcomePage"), handle: crumb("Welcome") },
          { path: "*", element: <RouteError />, loader: () => { throw new Response("Not found", { status: 404 }); } },
        ],
      },
    ],
  },
];

export const createRouter = () => createHashRouter(routes);
