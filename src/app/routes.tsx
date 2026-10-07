import { createHashRouter, type RouteObject } from "react-router";
import { useExercises, useSession } from "@/lib/ipc/queries";
import { TodayPage } from "@/features/today/TodayPage";
import { ExercisesPage } from "@/features/exercises/ExercisesPage";
import { ExerciseDetailPage } from "@/features/exercises/ExerciseDetailPage";
import { StudioPage } from "@/features/practice/StudioPage";
import { SessionsPage } from "@/features/sessions/SessionsPage";
import { TrashPage } from "@/features/sessions/TrashPage";
import { ReviewPage } from "@/features/review/ReviewPage";
import { ComparePage } from "@/features/review/ComparePage";
import { PhrasesPage } from "@/features/phrases/PhrasesPage";
import { ProgressPage } from "@/features/progress/ProgressPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
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
              { index: true, element: <ExercisesPage /> },
              {
                path: ":exerciseId",
                element: <ExerciseDetailPage />,
                handle: { crumb: (p) => <ExerciseCrumb id={p.exerciseId!} /> } satisfies RouteHandle,
              },
            ],
          },
          { path: "practice/:exerciseId", element: <StudioPage />, handle: crumb("Practice studio") },
          {
            path: "sessions",
            handle: crumb("Sessions"),
            children: [
              { index: true, element: <SessionsPage /> },
              { path: "trash", element: <TrashPage />, handle: crumb("Trash") },
              {
                path: ":sessionId",
                handle: { crumb: (p) => <SessionCrumb id={p.sessionId!} /> } satisfies RouteHandle,
                children: [
                  { index: true, element: <ReviewPage /> },
                  {
                    path: "attempt/:ordinal",
                    element: <ReviewPage />,
                    handle: { crumb: (p) => `Attempt ${p.ordinal}` } satisfies RouteHandle,
                  },
                  { path: "compare", element: <ComparePage />, handle: crumb("Compare attempts") },
                ],
              },
            ],
          },
          { path: "phrases", element: <PhrasesPage />, handle: crumb("Phrases") },
          { path: "progress", element: <ProgressPage />, handle: crumb("Progress") },
          { path: "settings/:section?", element: <SettingsPage />, handle: crumb("Settings") },
          { path: "*", element: <RouteError />, loader: () => { throw new Response("Not found", { status: 404 }); } },
        ],
      },
    ],
  },
];

export const createRouter = () => createHashRouter(routes);
