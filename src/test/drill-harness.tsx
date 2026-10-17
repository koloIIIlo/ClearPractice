import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { Toaster } from "sonner";
import { vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { ActivityResult, RecordingStatus, SavedRecording } from "@/lib/ipc/schemas";
import { DrillStudioPage } from "@/features/drills/DrillStudio";

/**
 * A client whose recording time the test sets (roadmap 10.1 tests, A-31):
 * `tick(ms)` sends a recording event at that time; Stop saves a take of that
 * length. Results default to a Just a Minute result.
 */
export function controlledRecording(result?: (attemptId: string) => ActivityResult) {
  const base = createMockClient();
  const listeners = new Set<(s: RecordingStatus) => void>();
  let attemptId = "";
  let elapsed = 0;
  const status = (phase: RecordingStatus["phase"], asset: SavedRecording | null = null): RecordingStatus => ({
    attemptId, phase, elapsedMs: elapsed, monotonicMs: elapsed, level: 0.2, clipping: false, error: null, asset,
  });
  const saved = (id: string): SavedRecording => ({
    attemptId: id, assetId: id, title: "Drill take", createdAtMs: Date.now(), durationMs: elapsed, sampleRate: 48_000, channels: 1,
    sourceChannels: 1, sourceFormat: "F32", bytes: 0, sha256: "0".repeat(64), recovered: false,
  });
  const client = {
    ...base,
    getRecordingStatus: async () => null,
    onRecordingEvent: async (listener: (s: RecordingStatus) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    startRecording: vi.fn(async (request: Parameters<IpcClient["startRecording"]>[0]) => {
      attemptId = request.attemptId;
      elapsed = 0;
      return status("recording");
    }),
    stopRecording: vi.fn(async (id: string) => saved(id)),
    addTakeEvents: vi.fn(async (_id: string, marks: unknown[]) => marks.length),
    getActivityResult: vi.fn(async (id: string): Promise<ActivityResult> =>
      result?.(id) ?? { attemptId: id, definitionVersion: 1, kind: "jam", speakingMs: 60_000, cleanSeconds: 47, hesitations: 3, longPauses: 1, longPauseMs: 2_100, repeats: 2, flags: 1, unavailableReason: null }),
  } satisfies IpcClient;
  const tick = (ms: number) => {
    elapsed = ms;
    listeners.forEach((listener) => listener(status("recording")));
  };
  return { client, tick };
}

/** The drill studio at `path` (e.g. "/drill/jam?seed=s1") in a data router, so the recorder guard works. */
export function renderDrill(path: string, client: IpcClient) {
  const router = createMemoryRouter(
    [
      { path: "/drill/:drillId", element: <DrillStudioPage /> },
      { path: "/elsewhere", element: <p>Somewhere else</p> },
      { path: "*", element: <p>Another page</p> },
    ],
    { initialEntries: [path] },
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <IpcContext.Provider value={client}>
        <TooltipProvider>
          <Toaster />
          <RouterProvider router={router} />
        </TooltipProvider>
      </IpcContext.Provider>
    </QueryClientProvider>,
  );
  return { ...view, router, queryClient };
}
