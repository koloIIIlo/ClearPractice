import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { buildTodayPlan } from "@/lib/today-plan";
import type { TodayPlan } from "@/lib/ipc/schemas";
import { StagePanel } from "./StagePanel";

const plan = (extra: Partial<TodayPlan>): TodayPlan => ({
  ...buildTodayPlan({ localDate: "2026-10-09", length: "short", sessions: [], phrases: [], latest: null }), ...extra,
});

function setup(p: TodayPlan) {
  const client: IpcClient = { ...createMockClient(), recordProgression: vi.fn(async (kind) => ({ kind, stageFrom: 2, stageTo: 3, reason: "", createdAt: "x" })) };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IpcContext.Provider value={client}>
        <StagePanel plan={p} />
      </IpcContext.Provider>
    </QueryClientProvider>,
  );
  return client;
}

it("offers the next stage with its reason and records your choice; easier practice is always there (4.18)", async () => {
  const user = userEvent.setup();
  const client = setup(plan({
    progression: { stage: 2, title: "Unfamiliar explanation", demand: "A new question", evidence: "3 unfamiliar sessions at this stage on 2 days since it started.",
      offer: { stage: 3, title: "Audience adaptation", reason: "Your latest one felt manageable (4 of 5)." } },
    suggestions: [{ text: "Try a different exercise today.", reason: "Your last three sessions were all Record and repeat." }],
  }));
  expect(screen.getByText("Stage 2 of 5")).toBeInTheDocument();
  expect(screen.getByText(/Ready to try audience adaptation\?/)).toBeInTheDocument();
  expect(screen.getByText("Your last three sessions were all Record and repeat.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try stage 3" }));
  expect(client.recordProgression).toHaveBeenCalledWith("advance", "Your latest one felt manageable (4 of 5).");
  await user.click(screen.getByRole("button", { name: "Not yet" }));
  expect(client.recordProgression).toHaveBeenLastCalledWith("stay", expect.any(String));
  await user.click(screen.getByRole("button", { name: "Easier practice" }));
  expect(client.recordProgression).toHaveBeenLastCalledWith("easier", expect.any(String));
});

it("shows nothing without a schedule, and no Easier button at stage 1", () => {
  const { container } = render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={createMockClient()}><StagePanel plan={plan({})} /></IpcContext.Provider></QueryClientProvider>);
  expect(container).toBeEmptyDOMElement();
  setup(plan({ progression: { stage: 1, title: "Clear explanation", demand: "d", evidence: "e", offer: null } }));
  expect(screen.queryByRole("button", { name: "Easier practice" })).not.toBeInTheDocument();
});
