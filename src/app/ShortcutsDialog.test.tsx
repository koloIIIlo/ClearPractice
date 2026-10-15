import { expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "@/App";
import { createMockClient } from "@/lib/ipc/mock-client";

it("lists the keyboard shortcuts on ? and from the top bar, but not while typing", async () => {
  const user = userEvent.setup();
  render(<App client={createMockClient()} />);
  await screen.findByRole("button", { name: "Start practice" });

  await user.keyboard("?");
  const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
  expect(within(dialog).getByText("Start or stop a take in the studio")).toBeInTheDocument();
  expect(within(dialog).getByText("Search, or go to any page")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Help" }));
  await user.click(await screen.findByRole("menuitem", { name: /Keyboard shortcuts/ }));
  expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  await user.keyboard("{Escape}");

  // A question mark typed into a field is just text.
  await user.keyboard("{Control>}k{/Control}");
  const search = await screen.findByRole("dialog");
  await user.type(within(search).getByRole("combobox"), "why?");
  expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();
});
