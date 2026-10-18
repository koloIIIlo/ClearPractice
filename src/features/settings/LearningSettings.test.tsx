import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import { renderWithApp } from "@/test/render";
import { LearningSettings } from "./SettingsPage";

it("saves the warm-up, when measures show and guessing first (11.3 to 11.5)", async () => {
  const user = userEvent.setup();
  const client = createMockClient();
  const save = vi.spyOn(client, "setPreferences");
  renderWithApp(<LearningSettings />, { client });
  await user.click(await screen.findByRole("switch", { name: "Start with a 2-minute warm-up game" }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ warmUp: true })));
  expect(screen.getByRole("radio", { name: /After every take/ })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: /When I ask/ }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ measuresTiming: "on_request" })));
  await user.click(screen.getByRole("switch", { name: "Guess before you see the measures" }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ predictFirst: true, predictTipSeen: true })));
  const name = screen.getByRole("textbox", { name: "Name for encouragement" });
  await user.type(name, " Alex ");
  await user.tab();
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ displayName: "Alex" })));
});
