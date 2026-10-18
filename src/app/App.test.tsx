import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "@/App";
import { createMockClient } from "@/lib/ipc/mock-client";

const renderApp = () => render(<App client={createMockClient()} />);

describe("app shell", () => {
  it("shows the five destinations and Settings in the sidebar", async () => {
    renderApp();
    await screen.findByRole("button", { name: "Start practice" });
    for (const label of ["Today", "Exercises", "Sessions", "Phrases", "Progress", "Settings"]) {
      expect(screen.getAllByRole("link", { name: label }).length).toBeGreaterThan(0);
    }
  });

  it("opens Today with one primary action", async () => {
    renderApp();
    expect(await screen.findByRole("button", { name: "Start practice" })).toBeInTheDocument();
    expect(screen.getByText("Saved on this computer")).toBeInTheDocument();
  });

  it("navigates to Sessions and into a session review using only the keyboard", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("button", { name: "Start practice" });

    const sessionsLink = screen.getAllByRole("link", { name: "Sessions" })[0];
    sessionsLink.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { level: 1, name: "Sessions" })).toBeInTheDocument();

    const row = await screen.findByRole("link", { name: "A habit I want to change" });
    row.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { level: 1, name: "A habit I want to change" })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "As transcribed" })).toBeInTheDocument();
  });

  it("opens the command palette with Ctrl+K and finds a phrase", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("button", { name: "Start practice" });

    await user.keyboard("{Control>}k{/Control}");
    // The palette's code loads on first use; a busy test worker can take more than a second.
    const dialog = await screen.findByRole("dialog", undefined, { timeout: 5_000 });
    await user.type(within(dialog).getByRole("combobox"), "track of time");
    expect(await within(dialog).findByText("I lost track of time")).toBeInTheDocument();
  });

  it("shows a not-found page for unknown routes without losing the shell", async () => {
    window.location.hash = "#/does-not-exist";
    renderApp();
    expect(await screen.findByRole("heading", { name: "This page doesn't exist" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Today" }).length).toBeGreaterThan(0);
  });
});
