import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import { renderWithApp } from "@/test/render";
import { WordsToWatch } from "./SettingsPage";

it("adds and removes your own words", async () => {
  const user = userEvent.setup();
  const base = createMockClient();
  const client = { ...base, setPreferences: vi.fn(base.setPreferences) };
  renderWithApp(<WordsToWatch />, { client });
  const defaults = await screen.findByRole("list", { name: "Default words to watch" });
  expect(within(defaults).getByText("basically")).toBeInTheDocument();
  expect(within(defaults).queryByText("like")).not.toBeInTheDocument();

  const input = screen.getByLabelText("Your words");
  await user.type(input, "  Like ");
  expect(screen.getByText("“Like” is counted every time, including ordinary uses.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(client.setPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ watchWords: ["like"] })));
  expect(input).toHaveValue("");
  expect(within(await screen.findByRole("list", { name: "Your words to watch" })).getByText("like")).toBeInTheDocument();

  // Duplicates and words already in the default list are refused.
  await user.type(input, "Actually");
  expect(screen.getByText("Already on the list.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  await user.clear(input);
  await user.type(input, "x".repeat(31));
  expect(screen.getByText("Keep it under 30 characters.")).toBeInTheDocument();
  await user.clear(input);

  await user.click(screen.getByRole("button", { name: "Remove like" }));
  await waitFor(() => expect(client.setPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ watchWords: [] })));
  await waitFor(() => expect(screen.queryByRole("list", { name: "Your words to watch" })).not.toBeInTheDocument());
});
