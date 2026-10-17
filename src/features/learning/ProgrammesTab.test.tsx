import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { toLocalDate } from "@/lib/phrase-schedule";
import { factsBuilder } from "@/test/fixtures/facts";
import { expectNoScores } from "@/test/no-scores";
import { renderWithApp } from "@/test/render";
import { ProgrammeCard } from "./ProgrammeCard";
import { ProgrammesTab } from "./ProgrammesTab";

const markDone = (title: string) => screen.getByRole("button", { name: `Mark done: ${title}` });

describe("the filler programme (11.6)", () => {
  it("runs end to end in the mock: start, steps, move on, repeat and finish", async () => {
    const user = userEvent.setup();
    const client = createMockClient();
    renderWithApp(<ProgrammesTab />, { client });
    await user.click(await screen.findByRole("button", { name: "Start the programme" }));
    expect(await screen.findByText("Week 1 of 4 · Notice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move on to week 2" })).toBeInTheDocument();
    for (const title of ["Catch it on 3 of your takes", "Review the candidates in 3 takes", "Note when fillers come most"]) {
      await user.click(markDone(title));
      await waitFor(() => expect(screen.queryByRole("button", { name: `Mark done: ${title}` })).toBeNull());
    }
    expect(await screen.findByText("You've done 3 steps this week.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move on to week 2" }));
    expect(await screen.findByText("Week 2 of 4 · Pause instead")).toBeInTheDocument();
    expect(screen.getByText(/This week's focus/)).toHaveTextContent("Pause between ideas instead of filling the gap");
    // Repeating a week starts it afresh; redoing a step earns nothing more.
    await user.click(markDone("Two Just a Minute rounds"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Mark done: Two Just a Minute rounds" })).toBeNull());
    await user.click(screen.getByRole("button", { name: "Repeat this week" }));
    expect(await screen.findByRole("button", { name: "Mark done: Two Just a Minute rounds" })).toBeInTheDocument();
    await user.click(markDone("Two Just a Minute rounds"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Mark done: Two Just a Minute rounds" })).toBeNull());
    // Moving on is always allowed, ready or not.
    await user.click(screen.getByRole("button", { name: "Move on to week 3" }));
    await user.click(await screen.findByRole("button", { name: "Move on to week 4" }));
    await user.click(await screen.findByRole("button", { name: "Finish the programme" }));
    expect(await screen.findByText(/You finished it on/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start the programme" })).toBeInTheDocument();
    const events = await client.listPracticeEvents();
    expect(events.filter((e) => e.kind === "programme_step").map((e) => e.xp)).toEqual([10, 10, 10, 10]);
    expect(document.body).not.toHaveTextContent(/fail|missed|behind/i);
    expectNoScores();
  });

  it("records a detected step by itself, once", async () => {
    const base = createMockClient();
    const run = await base.startProgramme("fillers-4w");
    const today = toLocalDate(new Date());
    let facts = factsBuilder(today).session();
    for (let i = 0; i < 3; i += 1) facts = facts.take({ catchRuns: [{ caught: 2, total: 3, localDate: today }] });
    const completeProgrammeStep = vi.spyOn(base, "completeProgrammeStep");
    const client: IpcClient = { ...base, getPracticeFacts: async () => facts.build(), completeProgrammeStep };
    renderWithApp(<ProgrammesTab />, { client });
    await waitFor(() => expect(completeProgrammeStep).toHaveBeenCalledWith(run.id, "w1-catch-3", null));
    const step = (await screen.findByText("Catch it on 3 of your takes")).closest("li")!;
    expect(within(step).getByText(/3 of 3/)).toBeInTheDocument();
    expect(step).toHaveTextContent("done");
    await new Promise((r) => setTimeout(r, 50));
    expect(completeProgrammeStep).toHaveBeenCalledTimes(1);
  });

  it("shows the week and the next step on Today while it runs", async () => {
    const client = createMockClient();
    const empty = renderWithApp(<ProgrammeCard />, { client });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Fewer fillers, in four weeks")).toBeNull();
    empty.unmount();
    await client.startProgramme("fillers-4w");
    renderWithApp(<ProgrammeCard />, { client });
    expect(await screen.findByText("Week 1 of 4 · Notice")).toBeInTheDocument();
    expect(await screen.findByText(/Next: Catch it on 3 of your takes/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start" })).toHaveAttribute("href", "/catch-it");
    expect(screen.getByRole("link", { name: "Open the programme" })).toHaveAttribute("href", "/exercises?tab=programmes");
  });
});
