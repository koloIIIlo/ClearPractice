import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SprintPage } from "@/features/learning/SprintPage";
import { loadSequence, stepUrl } from "@/features/practice/sequence";
import { createMockClient } from "@/lib/ipc/mock-client";
import { DEFAULT_PREFERENCES } from "@/lib/ipc/schemas";
import { toLocalDate } from "@/lib/phrase-schedule";
import { renderWithApp, renderWithRouter } from "@/test/render";
import { TodayPage } from "./TodayPage";

describe("Today and the learning engine (M11)", () => {
  it("saves the challenge dial", async () => {
    const user = userEvent.setup();
    const client = createMockClient();
    const setPreferences = vi.spyOn(client, "setPreferences");
    const getTodayPlan = vi.spyOn(client, "getTodayPlan");
    renderWithApp(<TodayPage />, { client });
    const dial = await screen.findByRole("group", { name: "Challenge" });
    expect(within(dial).getByRole("radio", { name: "Just right" })).toBeChecked();
    const calls = getTodayPlan.mock.calls.length;
    await user.click(within(dial).getByRole("radio", { name: "Harder" }));
    await waitFor(() => expect(setPreferences).toHaveBeenCalledWith(expect.objectContaining({ challengeBias: 1 })));
    // The plan is asked again, so the week's task can change; the stage never does.
    await waitFor(() => expect(getTodayPlan.mock.calls.length).toBeGreaterThan(calls));
    expect(within(dial).getByText(/Unfamiliar topics first, with half the preparation time/)).toHaveTextContent("Your stage only changes when you choose.");
  });

  it("adds a warm-up drill to the sequence only when it is on", async () => {
    const off = renderWithApp(<TodayPage />);
    expect(await screen.findByRole("heading", { name: /Today's sequence/ })).toBeInTheDocument();
    expect(screen.queryByText("Warm-up: Just a Minute")).toBeNull();
    off.unmount();
    const client = createMockClient();
    await client.setPreferences({ ...DEFAULT_PREFERENCES, warmUp: true });
    renderWithApp(<TodayPage />, { client });
    expect(await screen.findByText("Warm-up: Just a Minute")).toBeInTheDocument();
  });

  it("starts the sprint as a sequence", async () => {
    const { router } = renderWithRouter(
      [
        { path: "/sprint", element: <SprintPage /> },
        { path: "/drill/:drillId", element: <p>Drill studio</p> },
        { path: "/practice/:exerciseId", element: <p>Practice studio</p> },
      ],
      { path: "/sprint?area=voice" },
    );
    await waitFor(() => expect(router.state.location.pathname).not.toBe("/sprint"));
    const state = loadSequence(toLocalDate(new Date()))!;
    expect(state.title).toBe("Voice sprint");
    expect(state.steps.length).toBeGreaterThanOrEqual(2);
    expect(state.steps.length).toBeLessThanOrEqual(3);
    expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(stepUrl(state.steps[0], state.localDate));
  });

  it("sprints on the weakest area when none is named (Ctrl+K)", async () => {
    const { router } = renderWithRouter(
      [
        { path: "/sprint", element: <SprintPage /> },
        { path: "*", element: <p>Somewhere to practise</p> },
      ],
      { path: "/sprint" },
    );
    await waitFor(() => expect(router.state.location.pathname).not.toBe("/sprint"));
    expect(loadSequence(toLocalDate(new Date()))?.title).toMatch(/ sprint$/);
  });
});
