import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import { renderWithApp } from "@/test/render";
import { PracticeStyleSettings } from "./SettingsPage";

it("saves the style and disables celebrations in calm style", async () => {
  const base = createMockClient();
  const client = { ...base, setPreferences: vi.fn(base.setPreferences) };
  renderWithApp(<PracticeStyleSettings />, { client });
  const celebrations = await screen.findByRole("combobox", { name: "Celebrations" });
  expect(celebrations).toBeEnabled();
  expect(screen.getByRole("radio", { name: /Playful/ })).toBeChecked();
  await userEvent.click(screen.getByRole("radio", { name: /Calm/ }));
  await waitFor(() => expect(client.setPreferences).toHaveBeenCalledWith(expect.objectContaining({ practiceStyle: "calm", styleChosen: true })));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Celebrations" })).toBeDisabled());
  expect(screen.getByText("Calm style shows no celebrations.")).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "Celebration sound" })).toBeDisabled();
});
