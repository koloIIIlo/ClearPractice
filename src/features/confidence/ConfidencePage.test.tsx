import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import { renderWithApp } from "@/test/render";
import { ConfidencePage } from "./ConfidencePage";

it("shows ladder, routine, review and reel sections", async () => {
  renderWithApp(<ConfidencePage />);
  expect(screen.getByRole("heading", { level: 1, name: "Confidence" })).toBeInTheDocument();
  for (const name of ["Your ladder", "Your best moments this week", "Before a real talk", "After a real talk"]) {
    expect(screen.getByRole("region", { name })).toBeInTheDocument();
  }
  expect(screen.getByRole("link", { name: "Start the routine" })).toHaveAttribute("href", "/confidence/routine");
  expect(screen.getByRole("link", { name: "Write a review" })).toHaveAttribute("href", "/progress?view=real&form=aar");
  // The preview's sample ladder and its sample moments load into the page.
  expect(await screen.findByRole("list", { name: "Your ladder" })).toBeInTheDocument();
  expect(await screen.findByRole("list", { name: "Your best moments this week" })).toBeInTheDocument();
  // Plain words: discomfort, never a diagnosis.
  expect(document.body.textContent).not.toMatch(/anxious|anxiety|phobia/i);
});

it("lists the notes you kept from the routine, and removes one after asking", async () => {
  const user = userEvent.setup();
  const client = createMockClient();
  await client.saveRoutineRun({ steps: ["unload"], keptNote: "The demo might fail" });
  await client.saveRoutineRun({ steps: ["breathe"], keptNote: null });
  const remove = vi.spyOn(client, "deleteRoutineRun");
  renderWithApp(<ConfidencePage />, { client });
  await user.click(await screen.findByText("Notes you kept (1)"));
  expect(screen.getByText("The demo might fail")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /^Remove the note of/ }));
  await user.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByText("The demo might fail")).toBeNull());
});
