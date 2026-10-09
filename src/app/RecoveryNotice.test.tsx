import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { RecoveryNotice } from "./RecoveryNotice";

const show = (client: IpcClient, path = "/sessions") =>
  render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><RecoveryNotice /></IpcContext.Provider></QueryClientProvider></MemoryRouter>);

it("announces interrupted takes on every screen until they are recovered or discarded (6.3)", async () => {
  const take = { attemptId: "a1", title: "Habit", durationMs: 12_000, unavailableReason: null } as never;
  show({ ...createMockClient(), recordingMode: "native", listRecoverableRecordings: async () => [take, take] });
  expect(await screen.findByText(/2 takes were interrupted/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Recover or discard on Today" })).toHaveAttribute("href", "/");
});

it("stays quiet when nothing was interrupted", async () => {
  const { container } = show({ ...createMockClient(), recordingMode: "native", listRecoverableRecordings: async () => [] });
  await new Promise((r) => setTimeout(r, 20));
  expect(container).toBeEmptyDOMElement();
});
