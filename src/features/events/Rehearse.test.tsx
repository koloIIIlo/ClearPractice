import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import type { RehearsalReport } from "@/lib/ipc/schemas";
import { controlledRecording } from "@/test/drill-harness";
import { RehearsePage } from "./Rehearse";

afterEach(() => vi.restoreAllMocks());

function renderRehearse(client: IpcClient, talkId: string) {
  const router = createMemoryRouter([{ path: "/events/talks/:talkId/rehearse", element: <RehearsePage /> }], { initialEntries: [`/events/talks/${talkId}/rehearse`] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <IpcContext.Provider value={client}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </IpcContext.Provider>
    </QueryClientProvider>,
  );
}

describe("rehearsing a talk (14.3)", () => {
  it("writes a section mark when the card advances while recording", async () => {
    const user = userEvent.setup();
    const { client, tick } = controlledRecording();
    const talk = await client.saveTalk({
      title: "Team demo", template: "classic",
      sections: ["Opening", "What we built", "Close"].map((title) => ({ title, keywords: [], notes: "", targetSeconds: 60 })),
    });
    const [, built, close] = talk.sections;
    const report: RehearsalReport = {
      attemptId: "x", talkId: talk.talk.id, sessionId: "s", localDate: "2026-10-18", createdAt: "2026-10-18T10:00:00.000Z", totalTargetSeconds: 180, totalActualMs: 20_000, note: null, transcribed: false,
      sections: talk.sections.map((s) => ({ sectionId: s.id, title: s.title, targetSeconds: 60, reached: true, actualMs: 6_000, words: null, paceWpm: null, hesitations: null })),
    };
    const recorded = vi.fn(async (_talk: string, attemptId: string) => ({ ...report, attemptId }));
    const rehearse = { ...client, recordRehearsal: recorded };
    renderRehearse(rehearse, talk.talk.id);

    // Moving before recording marks nothing.
    expect(await screen.findByRole("heading", { level: 2, name: "Opening" })).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("heading", { level: 2, name: "What we built" })).toBeInTheDocument();

    const start = await screen.findByRole("button", { name: "Start rehearsing" });
    await waitFor(() => expect(start).toBeEnabled());
    await user.click(start);
    await waitFor(() => expect(client.startRecording).toHaveBeenCalledTimes(1));
    // A new take starts on the first card.
    expect(await screen.findByRole("heading", { level: 2, name: "Opening" })).toBeInTheDocument();
    act(() => tick(12_000));
    await user.keyboard("{ArrowRight}");
    act(() => tick(47_500));
    await user.keyboard("{PageDown}");
    await user.keyboard("{ArrowLeft}{ArrowRight}");
    act(() => tick(60_000));
    await user.click(screen.getByRole("button", { name: /Stop and save/ }));

    await waitFor(() => expect(client.addTakeEvents).toHaveBeenCalledTimes(1));
    const [attemptId, marks] = client.addTakeEvents.mock.calls[0];
    // Each section's first card change only, at the time into the take.
    expect(marks).toEqual([
      { atMs: 12_000, kind: "section_mark", data: { sectionId: built.id } },
      { atMs: 47_500, kind: "section_mark", data: { sectionId: close.id } },
    ]);
    await waitFor(() => expect(recorded).toHaveBeenCalledWith(talk.talk.id, attemptId));
    expect(await screen.findByRole("heading", { name: "This rehearsal" })).toBeInTheDocument();
  });
});
