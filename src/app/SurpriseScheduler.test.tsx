import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithApp } from "@/test/render";
import { createMockClient } from "@/lib/ipc/mock-client";
import { keys } from "@/lib/ipc/queries";
import { SURPRISE_DAY_KEY } from "@/lib/surprise";
import { SurpriseScheduler } from "./SurpriseScheduler";
afterEach(() => vi.useRealTimers());
async function dueClient() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 19, 17, 59));
  const client = createMockClient();
  await client.setPreferences({ ...await client.getPreferences(), surpriseEnabled: true });
  vi.spyOn(client, "listPracticeEvents").mockResolvedValue([]);
  vi.spyOn(client, "listSessions").mockResolvedValue([]);
  return client;
}
it("keeps Not now dismissed across app restarts and leaves Windows delivery off", async () => {
  const client = await dueClient();
  const notifications = vi.spyOn(client, "showSurpriseNotification");
  const user = userEvent.setup();
  const first = renderWithApp(<SurpriseScheduler />, { client });
  expect(await screen.findByText(/^Surprise prompt:/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Not now" }));
  expect(localStorage.getItem(SURPRISE_DAY_KEY)).toBe("2026-10-19");
  expect(notifications).not.toHaveBeenCalled();
  first.unmount();
  const second = renderWithApp(<SurpriseScheduler />, { client });
  await waitFor(() => expect(second.queryClient.getQueryState(keys.preferences)?.status).toBe("success"));
  expect(client.listPracticeEvents).toHaveBeenCalledTimes(1);
  second.unmount();
});
it("suppresses delivery after practice events or a failed history check", async () => {
  const client = await dueClient();
  vi.mocked(client.listPracticeEvents).mockResolvedValue([{ id: 1, kind: "phrase_reviewed", refId: "phrase", localDate: "2026-10-19", sessionId: null, attemptId: null, xp: 2, backfilled: false, createdAt: "2026-10-19T10:00:00Z" }]);
  const first = renderWithApp(<SurpriseScheduler />, { client });
  await waitFor(() => expect(client.listSessions).toHaveBeenCalledTimes(1));
  expect(localStorage.getItem(SURPRISE_DAY_KEY)).toBeNull();
  expect(screen.queryByText(/^Surprise prompt:/)).not.toBeInTheDocument();
  first.unmount();
  vi.mocked(client.listPracticeEvents).mockRejectedValue(new Error("History unavailable"));
  renderWithApp(<SurpriseScheduler />, { client });
  await waitFor(() => expect(client.listPracticeEvents).toHaveBeenCalledTimes(2));
  expect(localStorage.getItem(SURPRISE_DAY_KEY)).toBeNull();
  expect(screen.queryByText(/^Surprise prompt:/)).not.toBeInTheDocument();
});
it("stays once per run when storage cannot save today's dismissal", async () => {
  const client = await dueClient();
  localStorage.setItem(SURPRISE_DAY_KEY, "2026-10-18");
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
  try {
    const view = renderWithApp(<SurpriseScheduler />, { client });
    await screen.findByText(/^Surprise prompt:/);
    await act(async () => {
      view.queryClient.setQueryData(keys.preferences, { ...await client.getPreferences(), weeklyGoalDays: 4 });
    });
    expect(client.listPracticeEvents).toHaveBeenCalledTimes(1);
    view.unmount();
  } finally { storage.mockRestore(); }
});
