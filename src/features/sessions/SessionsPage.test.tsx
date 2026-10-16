import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { renderWithApp } from "@/test/render";
import { SessionsPage } from "./SessionsPage";

function setup(client: IpcClient, path = "/sessions") {
  return renderWithApp(<SessionsPage />, { client, path, routes: [{ path: "/sessions/trash", element: <p>Trash page</p> }] });
}

it("marks how much of each session is transcribed and moves a selection to Trash after asking", async () => {
  const user = userEvent.setup();
  const base = createMockClient();
  const client: IpcClient = { ...base, moveSessionToTrash: vi.fn(base.moveSessionToTrash) };
  setup(client);
  const table = await screen.findByRole("table");
  const row = (name: string) => within(table).getByRole("link", { name }).closest("tr")!;
  expect(row("A habit I want to change")).toHaveTextContent("Transcribed");
  expect(row("Explaining a work tool")).toHaveTextContent("Not transcribed");
  expect(within(table).getByText("2 of 3")).toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: "Select A habit I want to change" }));
  await user.click(screen.getByRole("checkbox", { name: "Select Explaining a work tool" }));
  const bar = screen.getByRole("region", { name: "Selected sessions" });
  expect(bar).toHaveTextContent("2 selected");
  expect(screen.getByRole("checkbox", { name: "Select all sessions shown" })).toHaveAttribute("data-state", "indeterminate");
  // Transcribing needs local Whisper; the preview says why it can't.
  expect(within(bar).getByRole("button", { name: /Transcribe all takes/ })).toBeDisabled();

  await user.click(within(bar).getByRole("button", { name: /Move to Trash/ }));
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent("Move 2 sessions to Trash?");
  await user.click(within(dialog).getByRole("button", { name: "Move to Trash" }));
  await waitFor(() => expect(client.moveSessionToTrash).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  // The toast's "Trash" opens the Trash page.
  // Toasts from earlier tests in the same run may still be fading out (not clickable); every
  // "Trash" link does the same, so skip the pointer check rather than pick one.
  await userEvent.setup({ pointerEventsCheck: 0 }).click((await screen.findAllByRole("button", { name: "Trash" }))[0]);
  expect(await screen.findByText("Trash page")).toBeInTheDocument();
});

it("shows only one day when opened from the activity calendar", async () => {
  const user = userEvent.setup();
  const base = createMockClient();
  const day = (await base.listSessions())[0].localDate;
  setup(base, `/sessions?date=${day}`);
  const all = (await base.listSessions()).length;
  const rows = () => within(screen.getByRole("table")).getAllByRole("row").length - 1; // minus the header row
  const chip = await screen.findByRole("button", { name: /Show all days/ });
  expect(rows()).toBeLessThan(all);
  await user.click(chip);
  await waitFor(() => expect(rows()).toBe(all));
});
