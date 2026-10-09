import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { StorageCategory } from "@/lib/ipc/schemas";
import { StorageUsage } from "./StorageUsage";

it("shows space by category and clears only the rebuildable cache after a confirmation (6.6)", async () => {
  const user = userEvent.setup();
  let cache = 5 * 1024 * 1024;
  const list = (): StorageCategory[] => [
    { key: "recordings", label: "Recordings", note: "Your takes", bytes: 300 * 1024 * 1024, files: 40, clearable: false },
    { key: "cache", label: "Rebuildable cache", note: "Rebuilt when needed", bytes: cache, files: 9, clearable: true },
  ];
  const client: IpcClient = {
    ...createMockClient(),
    recordingMode: "native",
    getStorageUsage: vi.fn(async () => list()),
    clearCache: vi.fn(async () => { const freed = cache; cache = 0; return freed; }),
  };
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><StorageUsage /></IpcContext.Provider></QueryClientProvider>);
  expect(await screen.findByText("300.0 MB")).toBeInTheDocument();
  expect(screen.getByText("305.0 MB")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear cache…" }));
  expect(client.clearCache).not.toHaveBeenCalled();
  expect(screen.getByText(/Remove 5.0 MB of rebuildable files\?/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear cache" }));
  expect(await screen.findByText("Freed 5.0 MB.")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Clear cache…" })).toBeDisabled();
});
