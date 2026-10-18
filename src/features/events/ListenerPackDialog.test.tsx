import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import { renderWithApp } from "@/test/render";
import { AskListenerButton, DEFAULT_QUESTIONS } from "./ListenerPackDialog";

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
