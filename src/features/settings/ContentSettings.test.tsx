import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { renderWithApp } from "@/test/render";
import { createMockClient } from "@/lib/ipc/mock-client";
import { ContentSettings } from "./ContentSettings";

it("imports a sample pack, practises its prompts and removes its live items", async () => {
  const client = createMockClient();
  const user = userEvent.setup();
  renderWithApp(<ContentSettings />, { client });
  await screen.findByText("No imported packs yet.");
  await user.click(screen.getByRole("button", { name: "Import a content pack…" }));
  await screen.findByText("Neighbourhood stories");
  expect(screen.getByText("1 prompts · 1 drill topics · 0 scenarios · 0 missions")).toBeInTheDocument();
  const prompts = await client.listPrompts();
  expect(prompts.some((p) => p.id === "pack-sample--market")).toBe(true);
  await client.setPromptFavorite("pack-sample--market", true);
  expect((await client.listPrompts()).find((p) => p.id === "pack-sample--market")?.favorite).toBe(true);
  await user.click(screen.getByRole("button", { name: "Remove Neighbourhood stories" }));
  await waitFor(() => expect(screen.queryByText("Neighbourhood stories")).not.toBeInTheDocument());
  expect((await client.listPrompts()).some((p) => p.id === "pack-sample--market")).toBe(false);
});
