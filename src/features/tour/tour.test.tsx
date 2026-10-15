import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import App from "@/App";
import { createMockClient } from "@/lib/ipc/mock-client";
import { TOUR_STEPS } from "./tour";

it("walks through the app page by page from Help, and remembers when it is closed", async () => {
  const user = userEvent.setup();
  const base = createMockClient();
  const client = { ...base, setPreferences: vi.fn(base.setPreferences) };
  render(<App client={client} />);
  await screen.findByRole("button", { name: "Start practice" });

  await user.click(screen.getByRole("button", { name: "Help" }));
  await user.click(await screen.findByRole("menuitem", { name: /Guided tour/ }));
  const card = await screen.findByRole("dialog", { name: TOUR_STEPS[0].title });
  expect(card).toHaveTextContent(`Step 1 of ${TOUR_STEPS.length}`);

  // Next moves on and opens each step's page.
  for (let i = 1; i <= 3; i++) await user.click(within(screen.getByRole("dialog", { name: TOUR_STEPS[i - 1].title })).getByRole("button", { name: "Next" }));
  expect(await screen.findByRole("dialog", { name: TOUR_STEPS[3].title })).toBeInTheDocument();
  expect(window.location.hash).toContain(TOUR_STEPS[3].route);
  await user.click(within(screen.getByRole("dialog", { name: TOUR_STEPS[3].title })).getByRole("button", { name: "Back" }));
  expect(await screen.findByRole("dialog", { name: TOUR_STEPS[2].title })).toBeInTheDocument();

  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: TOUR_STEPS[2].title })).not.toBeInTheDocument());
  expect(client.setPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ tourDone: true }));
});
