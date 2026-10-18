import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import { DEFAULT_PREFERENCES } from "@/lib/ipc/schemas";
import { renderWithApp } from "@/test/render";
import { BreathingCircle } from "./BreathingCircle";
import { RoutinePage } from "./RoutinePage";

const next = () => screen.getByRole("button", { name: /^(Next|Finish)$/ });

afterEach(() => vi.restoreAllMocks());

describe("the pre-talk routine (12.3)", () => {
  it("walks five steps and allows skipping any", async () => {
    const user = userEvent.setup();
    const client = createMockClient();
    const save = vi.spyOn(client, "saveRoutineRun");
    renderWithApp(<RoutinePage />, { client });
    const titles: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      titles.push((await screen.findByRole("heading", { level: 1 })).textContent ?? "");
      await user.click(i % 2 === 0 ? next() : screen.getByRole("button", { name: "Skip" }));
    }
    expect(titles).toEqual(["Cyclic sighing", "Voice warm-up", "Reframe", "Unload", "Encourage"]);
    expect(await screen.findByRole("heading", { name: "You're ready. Good luck." })).toBeInTheDocument();
    await waitFor(() => expect(save).toHaveBeenCalledWith({ steps: ["breathe", "reframe", "encourage"], keptNote: null }));
    const dots = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
    expect(dots).toHaveLength(5);
  });

  it("discards the worry text unless you keep it", async () => {
    const user = userEvent.setup();
    const client = createMockClient();
    const save = vi.spyOn(client, "saveRoutineRun");
    renderWithApp(<RoutinePage />, { client });
    for (let i = 0; i < 3; i += 1) await user.click(await screen.findByRole("button", { name: "Skip" }));
    await user.type(await screen.findByRole("textbox", { name: "Your worries, for one minute" }), "The demo might fail");
    expect(screen.getByRole("radio", { name: "Discard it" })).toBeChecked();
    await user.click(next());
    await user.click(next());
    await waitFor(() => expect(save).toHaveBeenCalledWith({ steps: ["unload", "encourage"], keptNote: null }));

    // Again, keeping the note this time.
    save.mockClear();
    const kept = renderWithApp(<RoutinePage />, { client });
    for (let i = 0; i < 3; i += 1) await user.click(within(kept.container).getAllByRole("button", { name: "Skip" })[0]);
    await user.type(within(kept.container).getByRole("textbox", { name: "Your worries, for one minute" }), "The demo might fail");
    await user.click(within(kept.container).getByRole("radio", { name: "Keep this note" }));
    await user.click(within(kept.container).getByRole("button", { name: "Next" }));
    await user.click(within(kept.container).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ steps: ["unload", "encourage"], keptNote: "The demo might fail" }));
  });

  it("uses your name in the encouragement or 'you' without one", async () => {
    const user = userEvent.setup();
    const client = createMockClient();
    const view = renderWithApp(<RoutinePage />, { client });
    for (let i = 0; i < 4; i += 1) await user.click(await screen.findByRole("button", { name: "Skip" }));
    expect(screen.getByText("You've got this. You've prepared.")).toBeInTheDocument();
    // Asked once, on the first routine.
    await user.type(screen.getByRole("textbox", { name: "Your first name (optional)" }), "Alex");
    await user.click(screen.getByRole("button", { name: "Use my name" }));
    expect(await screen.findByText("You've got this, Alex. You've prepared.")).toBeInTheDocument();
    view.unmount();
    await client.setPreferences({ ...DEFAULT_PREFERENCES, displayName: "Sam" });
    renderWithApp(<RoutinePage />, { client });
    for (let i = 0; i < 4; i += 1) await user.click(await screen.findByRole("button", { name: "Skip" }));
    expect(await screen.findByText("You've got this, Sam. You've prepared.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Your first name (optional)" })).toBeNull();
  });

  it("breathing cues are text-only under reduced motion", async () => {
    const user = userEvent.setup();
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...matchMedia(query), matches: query.includes("reduce") })) as typeof window.matchMedia;
    try {
      const { container } = renderWithApp(<BreathingCircle />);
      await user.click(screen.getByRole("button", { name: "Start breathing" }));
      expect(screen.getByText("Breathe in…")).toBeInTheDocument();
      const circle = container.querySelectorAll("circle")[1] as SVGCircleElement;
      expect(circle.getAttribute("class") ?? "").not.toContain("transition");
      expect(circle.style.transform).toBe("scale(0.75)");
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});
