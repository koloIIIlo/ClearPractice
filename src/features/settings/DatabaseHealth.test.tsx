import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { renderWithApp } from "@/test/render";
import { createMockClient } from "@/lib/ipc/mock-client";
import { DatabaseHealth } from "./DatabaseHealth";

it("compacts only on the button and hides the offer after dismissal", async () => {
  const client = createMockClient();
  const compact = vi.spyOn(client, "compactDatabase");
  const dismiss = vi.spyOn(client, "dismissDatabaseCompaction");
  const user = userEvent.setup();
  const view = renderWithApp(<DatabaseHealth />, { client });
  await screen.findByRole("button", { name: "Compact the database" });
  expect(compact).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Not this month" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Compact the database" })).not.toBeInTheDocument());
  expect(dismiss).toHaveBeenCalledOnce();
  expect(compact).not.toHaveBeenCalled();
  view.unmount();
  const fresh = createMockClient();
  const run = vi.spyOn(fresh, "compactDatabase");
  renderWithApp(<DatabaseHealth />, { client: fresh });
  await user.click(await screen.findByRole("button", { name: "Compact the database" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Compact the database" })).not.toBeInTheDocument());
  expect(run).toHaveBeenCalledOnce();
});
