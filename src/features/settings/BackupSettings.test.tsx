import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { BackupStatus } from "@/lib/ipc/schemas";
import { BackupSettings } from "./BackupSettings";

it("chooses a folder natively, reports verified and failed backups, and checks a backup without changing data", async () => {
  const user = userEvent.setup();
  let status: BackupStatus = { destination: null, destinationAvailable: false, backups: [] };
  const chosen: BackupStatus = { destination: "E:\\Backups", destinationAvailable: true, backups: [] };
  const client: IpcClient = {
    ...createMockClient(),
    recordingMode: "native",
    getBackupStatus: vi.fn(async () => status),
    chooseBackupDestination: vi.fn(async () => (status = chosen)),
    createBackup: vi.fn<IpcClient["createBackup"]>(async () => {
      status = { ...chosen, backups: [{ id: "b1", createdAt: "2026-10-08T10:00:00.000Z", fileName: "b1.zip", status: "verified" }] };
      return { id: "b1", fileName: "b1.zip", createdAtMs: 0, recordings: 3, unavailableRecordings: 1, bytes: 5 * 1024 * 1024 };
    }),
    previewRestore: vi.fn(async () => ({
      stagingId: "restore-1", backupId: "b1", createdAtMs: 0, appVersion: "0.1.0", schemaVersion: 2,
      sessions: 2, trashedSessions: 1, recordings: 3, audioBytes: 2048, unavailableRecordings: 0,
    })),
    discardRestorePreview: vi.fn(async () => {}),
  };
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><BackupSettings /></IpcContext.Provider></QueryClientProvider>);

  expect(await screen.findByText("Not chosen")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create backup" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /Choose folder/ }));
  expect(await screen.findByText("E:\\Backups")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Create backup" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Backup saved and verified: 3 recordings, 5.0 MB. 1 recording was already unavailable and could not be included.");
  expect(await screen.findByText(/b1\.zip/)).toBeInTheDocument();

  client.createBackup = vi.fn(async () => { throw new Error("There is not enough space for the backup."); });
  await user.click(screen.getByRole("button", { name: "Create backup" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("not enough space");
  expect(screen.getByText(/b1\.zip/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /Check a backup/ }));
  expect(await screen.findByText("This backup passed every check")).toBeInTheDocument();
  expect(screen.getByText(/2 sessions \(plus 1 in Trash\), 3 recordings/)).toBeInTheDocument();
  expect(screen.getByText(/current data has not been changed/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(client.discardRestorePreview).toHaveBeenCalledWith("restore-1");
});
