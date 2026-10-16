import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { renderWithApp } from "@/test/render";
import { StyleChoiceCard } from "./StyleChoiceCard";

function spyClient(): IpcClient {
  const base = createMockClient();
  return { ...base, setPreferences: vi.fn(base.setPreferences) };
}

it("records the calm choice", async () => {
  const client = spyClient();
  renderWithApp(<StyleChoiceCard />, { client });
  expect(screen.getByRole("region", { name: "Practice style" })).toHaveTextContent("never how your voice sounds");
  await userEvent.click(screen.getByRole("button", { name: "Choose calm" }));
  await waitFor(() => expect(client.setPreferences).toHaveBeenCalledWith(expect.objectContaining({ styleChosen: true, practiceStyle: "calm" })));
});

it("records the playful choice", async () => {
  const client = spyClient();
  renderWithApp(<StyleChoiceCard />, { client });
  await userEvent.click(screen.getByRole("button", { name: "Keep it playful" }));
  await waitFor(() => expect(client.setPreferences).toHaveBeenCalledWith(expect.objectContaining({ styleChosen: true, practiceStyle: "playful" })));
});
