import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { SessionSummary } from "@/lib/ipc/schemas";
import { toLocalDate } from "@/lib/phrase-schedule";
import { ActivityCalendar, activityByDay, intensity } from "./ActivityCalendar";

const session = (localDate: string, attemptCount: number, durationMs: number): SessionSummary => ({
  id: `s-${localDate}-${attemptCount}-${durationMs}`, title: "Practice", localDate, startedAt: `${localDate}T08:00:00Z`, exerciseType: "repeat",
  durationMs, attemptCount, favorite: false, hasNote: false, tags: [], status: "completed",
});

describe("activityByDay", () => {
  it("adds up each practised day and shades it by speaking time", () => {
    const days = activityByDay([session("2026-03-02", 2, 90_000), session("2026-03-02", 1, 60_000), session("2026-03-03", 0, 0)]);
    expect(days.get("2026-03-02")).toEqual({ sessions: 2, takes: 3, speakingMs: 150_000 });
    expect(days.has("2026-03-03")).toBe(false); // no take, no practice
    expect([undefined, { sessions: 1, takes: 1, speakingMs: 30_000 }, { sessions: 1, takes: 1, speakingMs: 3 * 60_000 }, { sessions: 1, takes: 2, speakingMs: 6 * 60_000 }, { sessions: 2, takes: 5, speakingMs: 12 * 60_000 }].map(intensity)).toEqual([0, 1, 2, 3, 4]);
  });
});

it("shows the whole year, and a practised day opens that day's sessions", async () => {
  const today = toLocalDate(new Date());
  const client: IpcClient = { ...createMockClient(), listSessions: async () => [session(today, 2, 4 * 60_000)] };
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <IpcContext.Provider value={client}>
          <ActivityCalendar />
        </IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const day = await screen.findByRole("link", { name: /1 session, 2 takes, 4 min speaking/ });
  expect(day).toHaveAttribute("href", `/sessions?date=${today}`);
  expect(screen.getByText(new RegExp(`1 day practised in ${today.slice(0, 4)}`))).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next year" })).toBeDisabled();
});
