import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { IpcContext } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { sessions } from "@/lib/ipc/mock-data";
import { NativeSession } from "./NativeSession";

it("keeps user edits after failed saving and never substitutes sample analysis for real audio", async () => {
  const session = { ...structuredClone(sessions[0]), conditions: null, conditionsUnavailableReason: "Not recorded in this older take.",
    attempts: [{ ...sessions[0].attempts[0], audioUnavailableReason: "File is missing; recovery chunks are kept." }] };
  const client = { ...createMockClient(), recordingMode: "native" as const,
    updateSession: vi.fn(async () => { throw new Error("Disk is full; your audio is preserved."); }),
    getAttemptReview: vi.fn() };
  render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><NativeSession session={session} /></IpcContext.Provider></QueryClientProvider></MemoryRouter>);
  expect(screen.getByText(/Task conditions unavailable/)).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("File is missing");
  expect(client.getAttemptReview).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My new title" } });
  fireEvent.change(screen.getByLabelText("Your note"), { target: { value: "I explained the trade-off." } });
  fireEvent.change(screen.getByLabelText("Tags, separated by commas"), { target: { value: "programming, clarity" } });
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await waitFor(() => expect(client.updateSession).toHaveBeenCalledWith(session.id, expect.objectContaining({
    title: "My new title", notes: "I explained the trade-off.", tags: ["programming", "clarity"],
  })));
  await screen.findByText("Disk is full; your audio is preserved.");
  expect(screen.getByLabelText("Title")).toHaveValue("My new title");
  expect(screen.queryByText("Session details saved on this computer.")).not.toBeInTheDocument();
});

it("exports a session through the native save dialog and reports what was included", async () => {
  const session = { ...structuredClone(sessions[0]), conditions: null, conditionsUnavailableReason: "Not recorded.",
    attempts: [{ ...sessions[0].attempts[0], audioUnavailableReason: "File is missing." }] };
  const client = { ...createMockClient(), recordingMode: "native" as const,
    exportSession: vi.fn(async () => ({ fileName: "Habit 2026-10-08.zip", recordings: 1, unavailableRecordings: 1, bytes: 10 })) };
  render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><NativeSession session={session} /></IpcContext.Provider></QueryClientProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Export…" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Exported Habit 2026-10-08.zip: notes, measurements and 1 original recording (1 unavailable, listed in the file).");
  expect(client.exportSession).toHaveBeenCalledWith(session.id);
});
