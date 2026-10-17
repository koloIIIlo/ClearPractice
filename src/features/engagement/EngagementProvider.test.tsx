import { act, screen, waitFor } from "@testing-library/react";
import { useMutation } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { IpcClient } from "@/lib/ipc";
import { DEFAULT_PREFERENCES } from "@/lib/ipc/schemas";
import { factsBuilder } from "@/test/fixtures/facts";
import { renderWithApp } from "@/test/render";
import { celebrationQueue } from "./celebrations";
import { EngagementProvider } from "./EngagementProvider";
import { requestEngagementRefresh } from "./refresh";

function client(over: Partial<IpcClient> = {}) {
  const base = createMockClient();
  const facts = factsBuilder().session().take().build();
  const ipc = {
    ...base,
    getPracticeFacts: vi.fn(async () => facts),
    recordUnlocks: vi.fn(base.recordUnlocks),
    setWeeklyQuests: vi.fn(base.setWeeklyQuests),
    ...over,
  } satisfies IpcClient;
  return ipc;
}

function Tagged() {
  const save = useMutation({ meta: { engagement: "phrase" }, mutationFn: async () => "ok" });
  return <button onClick={() => save.mutate()}>Save something</button>;
}

beforeEach(() => celebrationQueue.clear());
afterEach(() => vi.useRealTimers());

describe("EngagementProvider (9.4)", () => {
  it("records new unlocks once and invalidates engagement queries", async () => {
    const ipc = client();
    const { queryClient } = renderWithApp(<EngagementProvider><p>app</p></EngagementProvider>, { client: ipc });
    await waitFor(() => expect(ipc.recordUnlocks).toHaveBeenCalledTimes(1));
    const input = vi.mocked(ipc.recordUnlocks).mock.calls[0][0];
    expect(input.achievements.map((a) => a.id)).toContain("first-take");
    expect(ipc.setWeeklyQuests).toHaveBeenCalledTimes(1);
    const invalidated = vi.spyOn(queryClient, "invalidateQueries");
    act(() => requestEngagementRefresh("take"));
    await waitFor(() => expect(invalidated).toHaveBeenCalledWith({ queryKey: ["engagement"] }));
    // Nothing new the second time: no second write, and the week's quests stay.
    expect(ipc.recordUnlocks).toHaveBeenCalledTimes(1);
    expect(ipc.setWeeklyQuests).toHaveBeenCalledTimes(1);
  });

  it("debounces bursts into one evaluation", async () => {
    const ipc = client();
    renderWithApp(<EngagementProvider><p>app</p></EngagementProvider>, { client: ipc });
    await waitFor(() => expect(ipc.getPracticeFacts).toHaveBeenCalledTimes(1));
    act(() => {
      requestEngagementRefresh("take");
      requestEngagementRefresh("transcript");
      requestEngagementRefresh("review");
    });
    await waitFor(() => expect(ipc.getPracticeFacts).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 600));
    expect(ipc.getPracticeFacts).toHaveBeenCalledTimes(2);
  });

  it("does not celebrate on start", async () => {
    const ipc = client();
    renderWithApp(<EngagementProvider><p>app</p></EngagementProvider>, { client: ipc });
    await waitFor(() => expect(ipc.recordUnlocks).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(celebrationQueue.peek()).toEqual([]);
  });

  it("refreshes after a tagged mutation succeeds and celebrates in playful style", async () => {
    const user = userEvent.setup();
    let facts = factsBuilder().build();
    const ipc = client({ getPracticeFacts: vi.fn(async () => facts) });
    renderWithApp(<EngagementProvider><Tagged /></EngagementProvider>, { client: ipc });
    await waitFor(() => expect(ipc.getPracticeFacts).toHaveBeenCalledTimes(1));
    facts = factsBuilder().session().take().build();
    await user.click(screen.getByRole("button", { name: "Save something" }));
    await waitFor(() => expect(ipc.getPracticeFacts).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(celebrationQueue.peek().map((c) => c.headline)).toContain("Achievement: First take"));
  });

  it("records but never celebrates in calm style", async () => {
    let facts = factsBuilder().build();
    const ipc = client({ getPracticeFacts: vi.fn(async () => facts) });
    await ipc.setPreferences({ ...DEFAULT_PREFERENCES, practiceStyle: "calm" });
    renderWithApp(<EngagementProvider><p>app</p></EngagementProvider>, { client: ipc });
    await waitFor(() => expect(ipc.getPracticeFacts).toHaveBeenCalledTimes(1));
    facts = factsBuilder().session().take().build();
    act(() => requestEngagementRefresh("take"));
    await waitFor(() => expect(ipc.recordUnlocks).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(celebrationQueue.peek()).toEqual([]);
  });

  it("keeps working when the engagement call fails", async () => {
    const failing = vi.fn(async () => { throw new Error("storage busy"); });
    const ipc = client({ getEngagementState: failing });
    renderWithApp(<EngagementProvider><p>app still works</p></EngagementProvider>, { client: ipc });
    expect(screen.getByText("app still works")).toBeInTheDocument();
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(1));
    act(() => requestEngagementRefresh("take"));
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
