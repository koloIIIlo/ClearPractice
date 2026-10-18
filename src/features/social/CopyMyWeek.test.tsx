import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import { factsBuilder } from "@/test/fixtures/facts";
import { renderWithApp } from "@/test/render";
import { CopyMyWeek } from "./CopyMyWeek";

async function open() {
  const user = userEvent.setup();
  const client = createMockClient();
  const blank = { preparation: "", listenerText: "Private listener words", clarification: "", success: "Private success", selfReport: "", nextFocus: "" };
  await client.addTransferReview({ ...blank, situation: "Explained my job without notes.", localDate: "2026-10-17" });
  await client.addTransferReview({ ...blank, situation: "A different private conversation.", localDate: "2026-10-16" });
  await client.addTransferReview({ ...blank, situation: "Last week's reflection.", localDate: "2026-10-11" });
  const facts = factsBuilder("2026-10-18").session().take().build();
  renderWithApp(<CopyMyWeek />, { client: { ...client, getPracticeFacts: async () => facts } });
  await user.click(screen.getByRole("button", { name: "Copy my week" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Copy my week" }));
  await dialog.findByRole("region", { name: "Note preview" });
  await waitFor(() => expect(dialog.queryByText("Loading reflections…")).not.toBeInTheDocument());
  return { user, dialog };
}

describe("Copy my week dialog", () => {
  it("previews and copies only the chosen reflection", async () => {
    const { user, dialog } = await open();
    const copy = vi.spyOn(navigator.clipboard, "writeText");
    const preview = dialog.getByRole("region", { name: "Note preview" });
    expect(preview).not.toHaveTextContent("Explained my job");
    await user.click(dialog.getByRole("combobox", { name: "Highlight (optional)" }));
    expect(screen.queryByRole("option", { name: /Last week's reflection/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: /Explained my job without notes/ }));
    const text = within(preview).getByText(/^My speaking practice/).textContent!;
    expect(text).toContain('Highlight: "Explained my job without notes."');
    expect(text).not.toMatch(/Private listener words|Private success|different private conversation/);
    await user.click(dialog.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(text));
    expect(await screen.findByText("Your week was copied.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("allows a typed highlight and explains clipboard failure", async () => {
    const { user, dialog } = await open();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("Unavailable"));
    await user.click(dialog.getByRole("combobox", { name: "Highlight (optional)" }));
    await user.click(await screen.findByRole("option", { name: "Write my own" }));
    await user.type(dialog.getByRole("textbox", { name: "Your highlight" }), "Asked a question at work.");
    expect(dialog.getByRole("region", { name: "Note preview" })).toHaveTextContent('Highlight: "Asked a question at work."');
    await user.click(dialog.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText("The clipboard isn't available here.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(dialog.getByRole("combobox", { name: "Highlight (optional)" }));
    await user.click(await screen.findByRole("option", { name: "No highlight" }));
    expect(dialog.getByRole("region", { name: "Note preview" })).not.toHaveTextContent("Asked a question at work.");
  });
});
