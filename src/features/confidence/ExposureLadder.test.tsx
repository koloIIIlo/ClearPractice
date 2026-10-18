import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import { expectNoScores } from "@/test/no-scores";
import { renderWithApp } from "@/test/render";
import { DiscomfortScale, ofTen } from "./DiscomfortScale";
import { ExposureLadder } from "./ExposureLadder";

/** A mock client whose sample ladder was cleared, so the first visit shows the templates. */
async function emptyLadder() {
  const client = createMockClient();
  await client.saveExposureSteps([]);
  return client;
}

describe("the exposure ladder (12.2)", () => {
  it("builds a ladder from a template and reorders by keyboard", async () => {
    const user = userEvent.setup();
    const client = await emptyLadder();
    const save = vi.spyOn(client, "saveExposureSteps");
    renderWithApp(<ExposureLadder />, { client });
    await user.click(await screen.findByRole("button", { name: "Use the Meetings template" }));
    const list = screen.getByRole("list", { name: "Ladder steps" });
    expect(within(list).getAllByRole("textbox")).toHaveLength(8);
    expect(screen.getByRole("textbox", { name: "Step 1" })).toHaveValue("Record yourself alone and listen back.");
    // Keyboard only: focus "Move step 2 up" and press Enter.
    screen.getByRole("button", { name: "Move step 2 up" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("textbox", { name: "Step 1" })).toHaveValue("Send a voice message to a colleague.");
    await user.click(screen.getByRole("button", { name: "Remove step 8" }));
    await user.click(screen.getByRole("button", { name: "Save ladder" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ title: "Send a voice message to a colleague.", templateId: "meetings" })])));
    const saved = save.mock.calls.at(-1)![0];
    expect(saved.map((s) => s.title).slice(0, 2)).toEqual(["Send a voice message to a colleague.", "Record yourself alone and listen back."]);
    expect(saved).toHaveLength(7);
    const ladder = await screen.findByRole("list", { name: "Your ladder" });
    expect(within(ladder).getAllByRole("listitem")[0]).toHaveTextContent("Send a voice message to a colleague.");
  });

  it("records before and after ratings as your note", async () => {
    const user = userEvent.setup();
    const client = await emptyLadder();
    await client.saveExposureSteps([{ title: "Ask one question in a meeting" }]);
    const add = vi.spyOn(client, "addExposureAttempt");
    const update = vi.spyOn(client, "updateExposureAttempt");
    renderWithApp(<ExposureLadder />, { client });
    await user.click(await screen.findByRole("button", { name: "Plan: Ask one question in a meeting" }));
    const plan = await screen.findByRole("dialog", { name: "Plan this step" });
    expect(within(plan).getByText("Your note")).toBeInTheDocument();
    within(plan).getByRole("slider").focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(within(plan).getByText(ofTen(7))).toBeInTheDocument();
    await user.click(within(plan).getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(add).toHaveBeenCalledWith(expect.objectContaining({ outcome: "planned", beforeRating: 7, afterRating: null })));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("button", { name: "Plan: Ask one question in a meeting" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "I did it: Ask one question in a meeting" }));
    const done = await screen.findByRole("dialog", { name: "How did it go?" });
    expect(done).toHaveTextContent("You expected 7 of 10 beforehand.");
    await user.click(within(done).getByRole("radio", { name: "Partly" }));
    within(done).getByRole("slider").focus();
    await user.keyboard("{ArrowLeft}");
    await user.type(within(done).getByRole("textbox", { name: "Note (optional)" }), "Asked about the deadline");
    await user.click(within(done).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ outcome: "partly", beforeRating: 7, afterRating: 2, note: "Asked about the deadline" })));
    expect(await screen.findByText("done 1× · discomfort 7 → 2")).toBeInTheDocument();
    expectNoScores();
  });

  it("suggests the next step after two calm attempts and locks nothing", async () => {
    // The sample ladder: step 1 felt like 3 and then 1 afterwards.
    renderWithApp(<ExposureLadder />, { client: createMockClient() });
    const ladder = await screen.findByRole("list", { name: "Your ladder" });
    // The step rows themselves, not the attempts listed inside them.
    const [first, second, ...rest] = [...ladder.querySelectorAll<HTMLElement>(":scope > li")];
    expect(first).toHaveTextContent("This one feels manageable now. Ready for the next step?");
    expect(second).toHaveTextContent("Next");
    for (const row of [first, second, ...rest]) expect(within(row).getByRole("button", { name: /^I did it/ })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "Discomfort over your attempts" })).toBeInTheDocument();
    expect(document.querySelector("table caption")).toHaveTextContent("Discomfort before and after each attempt");
  });
});

describe("correcting the ladder", () => {
  it("removes a mistaken attempt after asking, and keeps what you earned", async () => {
    const user = userEvent.setup();
    const client = createMockClient();
    const remove = vi.spyOn(client, "deleteExposureAttempt");
    const earned = (await client.listPracticeEvents()).filter((e) => e.kind === "exposure_step").length;
    renderWithApp(<ExposureLadder />, { client });
    const ladder = await screen.findByRole("list", { name: "Your ladder" });
    const first = ladder.querySelector<HTMLElement>(":scope > li")!;
    await user.click(within(first).getByText("Attempts (3)"));
    const removes = within(first).getAllByRole("button", { name: /^Remove the attempt of/ });
    await user.click(removes[0]);
    await user.click(within(first).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(await within(first).findByText("Attempts (2)")).toBeInTheDocument();
    expect((await client.listPracticeEvents()).filter((e) => e.kind === "exposure_step")).toHaveLength(earned);
  });
});

describe("the discomfort scale", () => {
  it("reads as N of 10, never N/10", async () => {
    renderWithApp(<DiscomfortScale label="How uncomfortable?" value={6} onChange={() => {}} />);
    expect(screen.getByText("6 of 10")).toBeInTheDocument();
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "6 of 10");
    expect(document.body.textContent).not.toMatch(/\d+\s*\/\s*10/);
    expect(screen.getByText("Your note")).toBeInTheDocument();
  });
});
