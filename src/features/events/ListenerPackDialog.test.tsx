import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import { renderWithApp } from "@/test/render";
import { AskListenerButton, DEFAULT_QUESTIONS, QUESTION_PRESETS } from "./ListenerPackDialog";
import { ProgressPage } from "@/features/progress/ProgressPage";
import { formatDay } from "@/lib/format";

const TAKE = "s-06-a1";

async function open() {
  const user = userEvent.setup();
  const client = createMockClient();
  const save = vi.spyOn(client, "exportListenerPack");
  renderWithApp(<AskListenerButton attemptId={TAKE} />, { client });
  await user.click(screen.getByRole("button", { name: /Ask a listener/ }));
  const dialog = await screen.findByRole("dialog", { name: "Ask a listener" });
  return { user, client, save, dialog: within(dialog) };
}

describe("Ask a listener (14.4)", () => {
  it("fills the buddy preset and still allows edits", async () => {
    const { user, save, dialog } = await open();
    const select = dialog.getByRole("combobox", { name: "Questions" });
    await user.click(select);
    await user.click(await screen.findByRole("option", { name: "Buddy feedback" }));
    const questions = dialog.getAllByRole("textbox", { name: /^Question \d$/ });
    const buddy = QUESTION_PRESETS.find((p) => p.id === "buddy")!;
    expect(questions.map((q) => (q as HTMLInputElement).value)).toEqual([...buddy.questions]);
    await user.clear(questions[0]);
    await user.type(questions[0], "Which example helped?");
    expect(select).toHaveTextContent("Custom");
    await user.click(dialog.getByRole("button", { name: /Save the pack/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(TAKE, ["Which example helped?", ...buddy.questions.slice(1)], "", false));
  });

  it("lists buddies from imported answers", async () => {
    const client = createMockClient();
    for (let i = 0; i < 2; i += 1) {
      await client.exportListenerPack(TAKE, [...DEFAULT_QUESTIONS], "", false);
      await client.importListenerAnswers();
    }
    const answers = await client.listListenerFeedback();
    vi.spyOn(client, "listListenerFeedback").mockResolvedValue([
      { ...answers[0], listenerName: "Sam", importedAt: "2026-10-17T12:00:00Z" },
      { ...answers[1], listenerName: " sam ", importedAt: "2026-10-16T12:00:00Z" },
      { ...answers[0], id: "unnamed-1", listenerName: "", importedAt: "2026-10-15T12:00:00Z" },
      { ...answers[1], id: "unnamed-2", listenerName: "   ", importedAt: "2026-10-18T12:00:00Z" },
    ]);
    renderWithApp(<ProgressPage />, { client, path: "/progress?view=real" });
    const buddies = within(await screen.findByRole("region", { name: "Buddies" }));
    const sam = (await buddies.findByText("Sam")).closest("li")!;
    expect(sam).toHaveTextContent(`2 answer files · Last imported ${formatDay("2026-10-17")}`);
    expect(buddies.getByText("Unnamed listener").closest("li")).toHaveTextContent(`2 answer files · Last imported ${formatDay("2026-10-18")}`);
    expect(buddies.getAllByRole("listitem")).toHaveLength(2);
  });

  it("defaults to three questions and no transcript", async () => {
    const { user, client, save, dialog } = await open();
    const questions = dialog.getAllByRole("textbox", { name: /^Question \d$/ });
    expect(questions.map((q) => (q as HTMLInputElement).value)).toEqual([...DEFAULT_QUESTIONS]);
    expect(dialog.getByRole("checkbox", { name: "Include the transcript" })).not.toBeChecked();
    await user.type(dialog.getByRole("textbox", { name: /Your first name/ }), "Alex");
    await user.click(dialog.getByRole("button", { name: "Save the pack…" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(TAKE, [...DEFAULT_QUESTIONS], "Alex", false));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const [pack] = await client.listListenerPacks("s-06");
    expect(pack).toMatchObject({ attemptId: TAKE, questions: [...DEFAULT_QUESTIONS], from: "Alex", includeTranscript: false, answerFiles: 0 });
  });

  it("limits questions to five", async () => {
    const { user, save, dialog } = await open();
    const add = dialog.getByRole("button", { name: "Add a question" });
    await user.click(add);
    await user.click(add);
    expect(dialog.getAllByRole("textbox", { name: /^Question \d$/ })).toHaveLength(5);
    expect(add).toBeDisabled();
    // An empty question can't be saved; removing it can.
    expect(dialog.getByRole("button", { name: "Save the pack…" })).toBeDisabled();
    await user.click(dialog.getByRole("button", { name: "Remove question 5" }));
    await user.type(dialog.getByRole("textbox", { name: "Question 4" }), "Would you change one thing?");
    expect(add).toBeEnabled();
    await user.click(dialog.getByRole("button", { name: "Save the pack…" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(TAKE, [...DEFAULT_QUESTIONS, "Would you change one thing?"], "", false));
  });
});
