import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { SessionSummary } from "@/lib/ipc/schemas";
import { recapLine, WeekRow, weekRecap } from "./WeekRow";

const session = (localDate: string, attemptCount: number, durationMs: number): SessionSummary => ({
  id: `s-${localDate}-${attemptCount}`, title: "Practice", localDate, startedAt: `${localDate}T08:00:00Z`, exerciseType: "repeat",
  durationMs, attemptCount, favorite: false, hasNote: false, tags: [], status: "completed",
});

// Saturday 10 October 2026: the week runs Monday 5 to Sunday 11.
const TODAY = "2026-10-10";

describe("weekRecap", () => {
  it("fills this week's days that have a take and totals takes and speaking time", () => {
    const recap = weekRecap([session("2026-10-10", 2, 60_000), session("2026-10-07", 3, 90_000), session("2026-10-07", 1, 30_000), session("2026-10-06", 0, 0), session("2026-10-02", 4, 120_000)], TODAY);
    expect(recap.days.map((d) => d.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(recap.days.map((d) => d.practised)).toEqual([false, false, true, false, false, true, false]);
    expect(recap.days.find((d) => d.isToday)?.date).toBe(TODAY);
    expect(recap.days.at(-1)?.future).toBe(true);
    expect(recap.thisWeek).toEqual({ days: 2, takes: 6, speakingMs: 180_000 });
    expect(recapLine(recap)).toBe("2 days · 6 takes · 3 min speaking");
  });

  it("starts a new week from last week's work, never from a zero", () => {
    const monday = weekRecap([session("2026-10-02", 4, 150_000), session("2026-09-30", 1, 20_000)], "2026-10-05");
    expect(monday.thisWeek.days).toBe(0);
    expect(recapLine(monday)).toBe("New week. Last week: 2 days, 3 min speaking");
    expect(recapLine(weekRecap([session("2026-09-01", 1, 20_000)], TODAY))).toBe("Your next take fills today's dot");
  });
});

function setup(sessions: SessionSummary[]) {
  const client: IpcClient = { ...createMockClient(), listSessions: async () => sessions };
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IpcContext.Provider value={client}>
          <WeekRow today={TODAY} />
        </IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("WeekRow", () => {
  it("reads each day out for screen readers", async () => {
    setup([session("2026-10-09", 1, 40_000)]);
    const week = await screen.findByRole("region", { name: "Your week" });
    const days = within(week).getAllByRole("listitem");
    expect(days).toHaveLength(7);
    expect(days[4]).toHaveTextContent("Friday 9 October: practised");
    expect(days[5]).toHaveTextContent("Saturday 10 October: today, not yet");
    expect(days[6]).toHaveTextContent("Sunday 11 October: later this week");
    expect(week).toHaveTextContent("1 day · 1 take · 40 s speaking");
  });

  it("stays hidden before the first take", async () => {
    const { container } = setup([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
