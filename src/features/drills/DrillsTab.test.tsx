import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DRILLS } from "@/content/drills";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { IpcClient } from "@/lib/ipc";
import { DEFAULT_PREFERENCES, type PracticeFacts } from "@/lib/ipc/schemas";
import { toLocalDate } from "@/lib/phrase-schedule";
import { factsBuilder } from "@/test/fixtures/facts";
import { expectNoScores } from "@/test/no-scores";
import { renderWithApp } from "@/test/render";
import { DrillsTab, randomDrill } from "./DrillsTab";

const today = toLocalDate(new Date());
const activity = { version: 1, seed: "s", params: {} };

async function client(facts: PracticeFacts, opts: { calm?: boolean; transcription?: "ready" | "needs_setup" } = {}): Promise<IpcClient> {
  const base = createMockClient();
  const status = await base.getServiceStatus();
  const c: IpcClient = {
    ...base,
    getPracticeFacts: async () => facts,
    getServiceStatus: async () => ({ ...status, transcription: { ...status.transcription, state: opts.transcription ?? "needs_setup" } }),
  };
  await c.setPreferences({ ...DEFAULT_PREFERENCES, practiceStyle: opts.calm ? "calm" : "playful" });
  return c;
}
const card = (title: string) => screen.getByRole("heading", { level: 3, name: title }).closest("li")!;

describe("Exercises → Drills (10.14)", () => {
  it("filters by area", async () => {
    renderWithApp(<DrillsTab />, { client: await client(factsBuilder(today).build()) });
    expect(await screen.findByRole("heading", { level: 3, name: "Just a Minute" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Drills" })).getAllByRole("listitem")).toHaveLength(12);
    await userEvent.click(screen.getByRole("radio", { name: "Voice" }));
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Emphasis game", "Pace ladder"]);
  });

  it("shows best and recommendation in playful style only", async () => {
    const facts = factsBuilder(today).onDay(2).session({ exerciseType: "jam", activity }).take({ durationMs: 60_000, result: { cleanSeconds: 52 } }).build();
    const playful = renderWithApp(<DrillsTab />, { client: await client(facts) });
    await waitFor(() => expect(card("Just a Minute")).toHaveTextContent("Best: 52 clean seconds"));
    expect(card("Gauntlet")).toHaveTextContent("Recommended after Spontaneity 3. You can play it now.");
    expect(within(card("Gauntlet")).getByRole("link", { name: "Play Gauntlet" })).toHaveAttribute("href", "/drill/gauntlet");
    expectNoScores();
    playful.unmount();
    renderWithApp(<DrillsTab />, { client: await client(facts, { calm: true }) });
    await waitFor(() => expect(card("Just a Minute")).toHaveTextContent("Played 1 time"));
    expect(document.body.textContent).not.toMatch(/Best:|Recommended after/);
  });

  it("explains when a drill needs transcription", async () => {
    const view = renderWithApp(<DrillsTab />, { client: await client(factsBuilder(today).build()) });
    await waitFor(() => expect(card("Just a Minute")).toHaveTextContent("Full result needs local transcription."));
    expect(within(card("Just a Minute")).getByRole("link", { name: "Set it up" })).toHaveAttribute("href", "/settings/transcription");
    expect(card("Topic roulette")).not.toHaveTextContent("needs local transcription");
    view.unmount();
    renderWithApp(<DrillsTab />, { client: await client(factsBuilder(today).build(), { transcription: "ready" }) });
    await screen.findByRole("heading", { level: 3, name: "Just a Minute" });
    await new Promise((r) => setTimeout(r, 200));
    expect(document.body.textContent).not.toMatch(/needs local transcription/);
  });

  it("shows today's daily and the last 30 days, with no streak", async () => {
    const facts = factsBuilder(today).session({ exerciseType: "daily", activity }).take().onDay(3).session({ exerciseType: "daily", activity }).take().build();
    renderWithApp(<DrillsTab />, { client: await client(facts) });
    const daily = await screen.findByRole("region", { name: /Today's daily · #\d+/ });
    await waitFor(() => expect(daily).toHaveTextContent("Done today."));
    const days = within(daily).getByRole("list", { name: "Daily prompts in the last 30 days" });
    expect(within(days).getAllByRole("listitem")).toHaveLength(30);
    expect(days.textContent!.match(/: played/g)).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/streak|in a row/i);
  });

  it("Random drill prefers one not played lately", () => {
    let b = factsBuilder(today);
    for (const d of DRILLS.filter((d) => d.id !== "story-cubes")) b = b.onDay(1).session({ exerciseType: d.type, activity }).take({ durationMs: 30_000 });
    const facts = b.build();
    for (const seed of ["a", "b", "c", "d"]) expect(randomDrill(facts, today, seed).id).toBe("story-cubes");
    expect(new Set(["a", "b", "c", "d", "e", "f", "g"].map((s) => randomDrill(undefined, today, s).id)).size).toBeGreaterThan(1);
  });
});
