import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { RecordingLibrary } from "./RecordingLibrary";

it("discards an interrupted take only after confirming it is permanent", async () => {
  const user = userEvent.setup();
  let recoverable = [{ attemptId: "lost-1", title: "Interrupted answer", createdAtMs: 0, durationMs: 12_000, unavailableReason: null }];
  const client: IpcClient = {
    ...createMockClient(),
    recordingMode: "native",
    listRecordings: async () => [],
    listRecoverableRecordings: async () => recoverable,
    onRecordingEvent: async () => () => {},
    discardRecoverableRecording: vi.fn(async () => { recoverable = []; }),
  };
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><RecordingLibrary /></IpcContext.Provider></QueryClientProvider>);
  await user.click(await screen.findByRole("button", { name: "Discard…" }));
  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveTextContent("About 0:12 of unrecovered audio will be deleted");
  expect(dialog).toHaveTextContent("cannot be undone");
  await user.click(within(dialog).getByRole("button", { name: "Keep it" }));
  expect(client.discardRecoverableRecording).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Discard…" }));
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Discard permanently" }));
  expect(client.discardRecoverableRecording).toHaveBeenCalledWith("lost-1");
  expect(await screen.findByText(/first saved take will appear here/)).toBeInTheDocument();
  expect(screen.queryByText("Interrupted takes")).not.toBeInTheDocument();
});
