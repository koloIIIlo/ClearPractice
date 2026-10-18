import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import App from "@/App";
import { IpcContext } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { sessions } from "@/lib/ipc/mock-data";
import { CompletionPage } from "./CompletionPage";
import { SequenceDots } from "./SequenceBar";
import { advanceSequence, loadSequence, startSequence, stepUrl } from "./sequence";
import { DrillsTab } from "@/features/drills/DrillsTab";
import { DrillStudioPage } from "@/features/drills/DrillStudio";
import { toLocalDate } from "@/lib/phrase-schedule";
import { renderWithRouter } from "@/test/render";

const steps = [
  { exerciseType: "repeat" as const, title: "Record and repeat", minutes: 6 },
  { exerciseType: "thought_groups" as const, title: "Thought groups", minutes: 2 },
];

describe("today's sequence (4.10)", () => {
  it("starts, records sessions with takes, resumes the same day only, and ends after the last step", () => {
    const state = startSequence("2026-10-08", "standard", steps);
    expect(loadSequence("2026-10-08")?.index).toBe(0);
    expect(loadSequence("2026-10-09")).toBeNull(); // a new day starts fresh
    const second = advanceSequence(state, "session-a", true);
    expect(second.sessionIds).toEqual(["session-a"]);
    expect(loadSequence("2026-10-08")?.index).toBe(1);
    const done = advanceSequence(second, "session-b", false); // no take: not listed
    expect(done.sessionIds).toEqual(["session-a"]);
    expect(loadSequence("2026-10-08")).toBeNull();
    // The same day always opens the same content, so a resumed step matches.
    expect(stepUrl(steps[1], "2026-10-08")).toBe(stepUrl(steps[1], "2026-10-08"));
    expect(stepUrl(steps[1], "2026-10-08")).toMatch(/^\/practice\/ex-thought-groups\?passage=tg-[a-z-]+&seq=1$/);
  });

  it("walks from Today through the steps with a step banner and finishes on the completion view", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/";
    render(<App client={createMockClient()} />);
    await user.click(await screen.findByRole("button", { name: "Start practice" }, { timeout: 5000 }));
    // The Studio route loads on first visit, including its optional review UI.
    const bar = await screen.findByRole("region", { name: "Today's practice" }, { timeout: 5_000 });
    expect(bar).toHaveTextContent("step 1 of 4");
    await user.click(within(bar).getByRole("button", { name: /Next step/ }));
    expect(await screen.findByRole("region", { name: "Today's practice" })).toHaveTextContent("step 2 of 4 · Thought groups");
    for (let i = 0; i < 2; i++) await user.click(within(screen.getByRole("region", { name: "Today's practice" })).getByRole("button", { name: /Next step/ }));
    await user.click(within(screen.getByRole("region", { name: "Today's practice" })).getByRole("button", { name: /Finish/ }));
    expect(await screen.findByRole("heading", { name: "Practice complete" })).toBeInTheDocument();
    expect(screen.getByText(/No takes were saved in this sequence/)).toBeInTheDocument();
  }, 10_000);
});

it("stores the ease rating and takeaway on every session of the sequence (4.11)", async () => {
  const user = userEvent.setup();
  const client = { ...createMockClient(), setSessionReflection: vi.fn(async () => {}) };
  const ids = [sessions[0].id, sessions[1].id];
  render(
    <MemoryRouter initialEntries={[{ pathname: "/practice/done", state: { sessionIds: ids } }]}>
      <QueryClientProvider client={new QueryClient()}>
        <IpcContext.Provider value={client}>
          <Routes><Route path="/practice/done" element={<CompletionPage />} /></Routes>
        </IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByRole("link", { name: new RegExp(sessions[0].title) })).toBeInTheDocument();
  expect(screen.getByText(/It is never a score/)).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "4 · Easy" }));
  await user.type(screen.getByLabelText("One thing to keep for next time"), "Pause before the example");
  await user.click(screen.getByRole("button", { name: "Save reflection" }));
  await waitFor(() => expect(client.setSessionReflection).toHaveBeenCalledTimes(2));
  expect(client.setSessionReflection).toHaveBeenCalledWith(ids[1], 4, "Pause before the example");
  expect(await screen.findByText("Saved with today's sessions.")).toBeInTheDocument();
});

it("walks a mixed set of three drills (11.3)", async () => {
  const user = userEvent.setup();
  renderWithRouter([
    { path: "/", element: <DrillsTab /> },
    { path: "/drill/:drillId", element: <DrillStudioPage /> },
  ]);
  await user.click(await screen.findByRole("button", { name: /Mixed set/ }));
  const state = loadSequence(toLocalDate(new Date()))!;
  expect(state.title).toBe("Mixed set");
  expect(new Set(state.steps.map((s) => s.drillId)).size).toBe(3);
  const bar = await screen.findByRole("region", { name: "Mixed set" }, { timeout: 8_000 });
  expect(bar).toHaveTextContent(`Mixed set · step 1 of 3 · ${state.steps[0].title}`);
  await user.click(within(bar).getByRole("button", { name: /Next step/ }));
  expect(await screen.findByRole("region", { name: "Mixed set" })).toHaveTextContent(`step 2 of 3 · ${state.steps[1].title}`);
});

it("marks done, current and upcoming steps", () => {
  const all = [...steps, { exerciseType: "imitate" as const, title: "Listen and imitate", minutes: 3 }];
  render(<SequenceDots steps={all} index={1} />);
  const dots = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
  expect(dots.map((d) => d.getAttribute("aria-label"))).toEqual([
    "Step 1 of 3, Record and repeat, done",
    "Step 2 of 3, Thought groups, current",
    "Step 3 of 3, Listen and imitate, upcoming",
  ]);
  expect(dots[0].querySelector("svg")).not.toBeNull();
  expect(dots[2].querySelector("svg")).toBeNull();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
