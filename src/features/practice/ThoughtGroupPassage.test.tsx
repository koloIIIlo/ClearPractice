import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import App from "@/App";
import { createMockClient } from "@/lib/ipc/mock-client";
import { PASSAGES } from "@/content/passages";
import { passagePrompt, ThoughtGroupPassage } from "./ThoughtGroupPassage";

it("shows the passage in thought groups, then hides it for a free explanation", async () => {
  const user = userEvent.setup();
  render(<ThoughtGroupPassage passage={PASSAGES[1]} locked={false} onChoose={vi.fn()} />);
  expect(screen.getByLabelText(/Passage in \d+ thought groups/)).toHaveTextContent("A variable is a name for a value");
  await user.click(screen.getByRole("button", { name: "Hide the text and explain" }));
  expect(screen.queryByText(/A variable is a name for a value/)).not.toBeInTheDocument();
  expect(screen.getByText("Explain the idea in your own words.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Show the text again" }));
  expect(screen.getByText(/A variable is a name for a value/)).toBeInTheDocument();
});

it("records takes under a task that names the passage", () => {
  expect(passagePrompt(PASSAGES[0]).text).toBe('Read "City parks" in thought groups, then explain it in your own words.');
});

it("opens the Thought groups exercise with a passage instead of a prompt outline", async () => {
  window.location.hash = "#/practice/ex-thought-groups?passage=tg-inflation";
  render(<App client={createMockClient()} />);
  expect(await screen.findByRole("heading", { name: "Inflation" }, { timeout: 5000 })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent('Read "Inflation" in thought groups');
  expect(screen.queryByLabelText("Point")).not.toBeInTheDocument();
});
