import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { IpcClient } from "@/lib/ipc";
import type { SelfCheck } from "@/lib/ipc/schemas";
import { renderWithApp } from "@/test/render";
import { SelfChecks } from "./SelfChecks";

function client() {
  const saved: SelfCheck[] = [];
  const ipc: IpcClient = {
    ...createMockClient(),
    listSelfChecks: async () => structuredClone(saved),
    setSelfCheck: vi.fn(async (attemptId, checkId, value) => {
      const at = saved.findIndex((c) => c.checkId === checkId);
      if (at >= 0) saved.splice(at, 1);
      if (value !== null) saved.push({ attemptId, checkId, value, createdAt: "2026-10-16T08:00:00.000Z" });
    }),
  };
  return ipc;
}

const opener = { text: "Um, so the first thing I do is plan.", segment: 0, hint: "starts_with_hesitation" as const };
const ending = { text: "…so yeah.", segment: 3, hint: "trails_off" as const };

describe("SelfChecks", () => {
  it("saves a choice immediately and clears it when clicked again", async () => {
    const user = userEvent.setup();
    const ipc = client();
    renderWithApp(<SelfChecks attemptId="take-1" opener={opener} ending={ending} />, { client: ipc });
    const question = await screen.findByRole("radiogroup", { name: "Did you open with your point?" });
    const yes = within(question).getByRole("radio", { name: "Yes" });
    await waitFor(() => expect(yes).toBeEnabled());
    await user.click(yes);
    expect(yes).toHaveAttribute("data-state", "on");
    expect(ipc.setSelfCheck).toHaveBeenLastCalledWith("take-1", "point_first", true);
    await user.click(yes);
    expect(ipc.setSelfCheck).toHaveBeenLastCalledWith("take-1", "point_first", null);
    await waitFor(() => expect(yes).toHaveAttribute("data-state", "off"));
    const ending_ = screen.getByRole("radiogroup", { name: "Did you finish clearly?" });
    await user.click(within(ending_).getByRole("radio", { name: "Not this time" }));
    expect(ipc.setSelfCheck).toHaveBeenLastCalledWith("take-1", "clear_ending", false);
    expect(screen.getByText("Your note")).toBeInTheDocument();
  });

  it("quotes the opening and ending sentences", async () => {
    renderWithApp(<SelfChecks attemptId="take-1" opener={opener} ending={ending} />, { client: client() });
    expect(await screen.findByText("Um, so the first thing I do is plan.")).toBeInTheDocument();
    expect(screen.getByText("starts with a hesitation")).toBeInTheDocument();
    expect(screen.getByText("…so yeah.")).toBeInTheDocument();
    expect(screen.getByText("trails off")).toBeInTheDocument();
  });

  it("asks about your voice only on takes of 90 seconds or more", async () => {
    const { unmount } = renderWithApp(<SelfChecks attemptId="take-1" opener={null} ending={null} durationMs={60_000} />, { client: client() });
    await screen.findByRole("radiogroup", { name: "Did you finish clearly?" });
    expect(screen.queryByRole("radiogroup", { name: "Did you vary your voice on purpose?" })).not.toBeInTheDocument();
    unmount();
    renderWithApp(<SelfChecks attemptId="take-1" opener={null} ending={null} durationMs={95_000} />, { client: client() });
    expect(await screen.findByRole("radiogroup", { name: "Did you vary your voice on purpose?" })).toBeInTheDocument();
  });
});
