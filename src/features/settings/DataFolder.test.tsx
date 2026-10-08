import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { DataLocation } from "@/lib/ipc/schemas";
import { DataFolder } from "./DataFolder";

function setup(overrides: Partial<IpcClient>) {
  const client: IpcClient = { ...createMockClient(), recordingMode: "native", ...overrides };
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><DataFolder /></IpcContext.Provider></QueryClientProvider>);
  return client;
}

const location = (over: Partial<DataLocation> = {}): DataLocation => ({
  current: "C:\\Users\\me\\AppData\\Local\\com.clearpractice.app", default: "C:\\Users\\me\\AppData\\Local\\com.clearpractice.app", custom: false, problem: null, previous: null, previousBytes: 0, ...over,
});

it("moves the data to a chosen folder with progress, then restarts the app (2.25)", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  let report: (p: { done: number; total: number }) => void = () => {};
  let finish: (target: string) => void = () => {};
  const client = setup({
    getDataLocation: async () => location(),
    onDataMoveProgress: async (listener) => { report = listener; return () => {}; },
    moveDataFolder: vi.fn(() => new Promise<string | null>((resolve) => { finish = resolve; })),
    restartApp: vi.fn(async () => {}),
  });
  expect(await screen.findByText("(default)")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Move data folder…" }));
  expect(client.moveDataFolder).toHaveBeenCalledWith(false);
  act(() => report({ done: 1_048_576, total: 4 * 1_048_576 }));
  expect(screen.getByRole("status", { name: "Data move progress" })).toHaveTextContent("Copying and checking… 25% of 2.0 MB");
  await act(async () => finish("D:\\ClearPractice"));
  expect(await screen.findByText(/Copied and checked to D:\\ClearPractice/)).toBeInTheDocument();
  expect(client.restartApp).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(1_600); });
  expect(client.restartApp).toHaveBeenCalledOnce();
  vi.useRealTimers();
});

it("explains a missing data folder and removes the old copy only after a confirmation", async () => {
  const user = userEvent.setup();
  let current = location({ current: "D:\\ClearPractice", custom: true, previous: "C:\\old", previousBytes: 3 * 1_073_741_824, problem: null });
  const client = setup({
    getDataLocation: async () => current,
    removeOldDataCopy: vi.fn(async () => { current = { ...current, previous: null, previousBytes: 0 }; }),
  });
  expect(await screen.findByText(/An older copy of your data \(3\.0 GB\)/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Move back to the default folder" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Remove old copy…" }));
  expect(client.removeOldDataCopy).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Remove old copy" }));
  expect(client.removeOldDataCopy).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByText(/An older copy/)).not.toBeInTheDocument());
});
