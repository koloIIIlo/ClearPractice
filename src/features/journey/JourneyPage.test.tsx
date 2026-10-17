import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import App from "@/App";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { IpcClient } from "@/lib/ipc";
import { DEFAULT_PREFERENCES } from "@/lib/ipc/schemas";
import { factsBuilder } from "@/test/fixtures/facts";
import { expectNoScores } from "@/test/no-scores";
import { renderWithApp } from "@/test/render";
import { Companion } from "./Companion";
import { AchievementsPage } from "./AchievementsPage";
import { JourneyPage } from "./JourneyPage";

afterEach(() => {
  window.location.hash = "#/";
});

function client(over: Partial<IpcClient> = {}): IpcClient {
  const facts = factsBuilder()
    .onDay(2).session({ outline: [true, false, false], familiarity: "unfamiliar" }).take({ transcribed: true, fillersReviewed: true })
    .onDay(1).session({ outline: [true, true, true] }).take({ transcribed: true, fillersReviewed: true }).take()
    .build();
  return { ...createMockClient(), getPracticeFacts: async () => facts, ...over };
}

describe("Journey (9.1)", () => {
  it("shows the eight areas with level and next step", async () => {
    renderWithApp(<JourneyPage />, { client: client(), path: "/journey" });
    const cards = await screen.findAllByRole("button", { name: /, level \d of 5, / });
    expect(cards).toHaveLength(8);
    expect(cards[0]).toHaveAccessibleName(/^Structure & clarity, level 0 of 5, Not started\. Next: Point first, 2 of 3\.$/);
    expect(screen.getByRole("button", { name: /^Spontaneity, level 0 of 5, Not started\. Next: First unknown: ready\.$/ })).toBeInTheDocument();
    expect(screen.getByText(/XP measures effort only/)).toBeInTheDocument();
    expectNoScores();
  });

  it("opens the area sheet from a card and from ?area=", async () => {
    const user = userEvent.setup();
    const view = renderWithApp(<JourneyPage />, { client: client(), path: "/journey" });
    await user.click(await screen.findByRole("button", { name: /^Fluency, level/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("heading", { name: "Fluency" })).toBeInTheDocument();
    expect(within(sheet).getByText("Level 1 · Aware")).toBeInTheDocument();
    expect(within(sheet).getByText(/never a grade of your English/)).toBeInTheDocument();
    view.unmount();
    renderWithApp(<JourneyPage />, { client: client(), path: "/journey?area=voice" });
    expect(within(await screen.findByRole("dialog")).getByRole("heading", { name: "Voice & delivery" })).toBeInTheDocument();
  });

  it("explains the empty journey", async () => {
    renderWithApp(<JourneyPage />, { client: client({ getPracticeFacts: async () => factsBuilder().build() }), path: "/journey" });
    expect(await screen.findByText(/Your journey starts with your first take/)).toBeInTheDocument();
  });

  it("is hidden from the sidebar in calm style but opens directly", async () => {
    const calm = client();
    await calm.setPreferences({ ...DEFAULT_PREFERENCES, onboarded: true, tourDone: true, practiceStyle: "calm", styleChosen: true });
    window.location.hash = "#/journey";
    render(<App client={calm} />);
    expect(await screen.findByText(/You're in Calm style\. This page isn't in the sidebar\./, {}, { timeout: 8000 })).toBeInTheDocument();
    const nav = screen.getAllByRole("navigation").find((n) => within(n).queryByRole("link", { name: /Progress/ }))!;
    expect(within(nav).queryByRole("link", { name: /Journey/ })).not.toBeInTheDocument();
  }, 20_000);

  it("is in the sidebar in playful style", async () => {
    const playful = client();
    await playful.setPreferences({ ...DEFAULT_PREFERENCES, onboarded: true, tourDone: true, styleChosen: true });
    window.location.hash = "#/";
    render(<App client={playful} />);
    await waitFor(() => expect(screen.getAllByRole("link", { name: /Journey/ }).length).toBeGreaterThan(0), { timeout: 8000 });
  }, 20_000);
});

describe("Sprout and achievements (9.6, 9.11)", () => {
  it("renders every stage with a label", () => {
    for (let stage = 0; stage <= 8; stage += 1) {
      const { unmount } = render(<Companion stage={stage} />);
      expect(screen.getByRole("img")).toHaveAccessibleName(new RegExp(`at stage ${stage} of 8\\. It grows with your practice days\\.`));
      unmount();
    }
  });

  it("groups, filters and shows progress", async () => {
    const user = userEvent.setup();
    renderWithApp(<AchievementsPage />, { client: client() });
    expect(await screen.findByRole("heading", { name: "Getting started" })).toBeInTheDocument();
    expect(screen.getByText("First take")).toBeInTheDocument();
    expect(screen.getByText("Hundred reviews").closest("li")).toHaveTextContent("0 of 100");
    await user.click(screen.getByRole("radio", { name: "Unlocked" }));
    expect(screen.queryByText("Hundred reviews")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "In progress" }));
    expect(screen.getByText("Hundred reviews")).toBeInTheDocument();
    expectNoScores();
  });
});
