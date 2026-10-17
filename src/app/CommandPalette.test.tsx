import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFERENCES } from "@/lib/ipc/schemas";
import { renderWithApp } from "@/test/render";
import { CommandPalette } from "./CommandPalette";
import { matchingActions, PALETTE_ACTIONS, type PaletteContext } from "./palette-actions";
import { ThemeProvider } from "./theme";

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

const ctx = (over: Partial<PaletteContext> = {}): PaletteContext => ({
  navigate: vi.fn(), preferences: DEFAULT_PREFERENCES, theme: "system", setTheme: vi.fn(), zoom: vi.fn(), playful: true, today: "2026-10-16", ...over,
});

describe("Ctrl+K actions (8.10)", () => {
  it("runs an action and closes", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithApp(
      <ThemeProvider>
        <CommandPalette open onOpenChange={onOpenChange} />
        <Where />
      </ThemeProvider>,
    );
    expect(await screen.findByText("Actions")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/Search sessions/), "reflection");
    await user.keyboard("{Enter}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/progress?view=real"));
  });

  it("switches theme and zoom by keyboard alone", () => {
    const setTheme = vi.fn();
    const zoom = vi.fn();
    const c = ctx({ setTheme, zoom, theme: "light" });
    const labels = matchingActions(c, "theme").map((a) => a.label);
    expect(labels).toEqual(["Use the dark theme", "Follow the Windows theme"]);
    matchingActions(c, "dark")[0].run(c);
    expect(setTheme).toHaveBeenCalledWith("dark");
    matchingActions(c, "zoom in")[0].run(c);
    expect(zoom).toHaveBeenCalledWith(1);
  });

  it("hides Journey in calm style", () => {
    const journey = PALETTE_ACTIONS.find((a) => a.id === "journey")!;
    const built = { journey: true, justAMinute: false, conversation: false };
    expect(journey.visible(ctx({ playful: true, features: built }))).toBe(true);
    expect(journey.visible(ctx({ playful: false, features: built }))).toBe(false);
    // Built with M9: shown in Playful style by default, never in Calm.
    expect(journey.visible(ctx({ playful: true }))).toBe(true);
    expect(journey.visible(ctx({ playful: false }))).toBe(false);
    expect(matchingActions(ctx({ playful: false, features: built }), "journey")).toEqual([]);
  });
});
