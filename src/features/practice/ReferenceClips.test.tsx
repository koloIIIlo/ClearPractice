import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { ReferenceClip } from "@/lib/ipc/schemas";
import { ReferenceClips } from "./ReferenceClips";

const imported: ReferenceClip = {
  id: "clip-1", origin: "user", title: "Opening of the talk", source: "Speaker, Talk title, 2024", transcript: "Thank you all for coming.",
  durationMs: 12_500, sha256: "a".repeat(64), createdAtMs: 1,
};

it("imports a section of a local file with a title and credit, then plays it with its transcript (4.4a)", async () => {
  const user = userEvent.setup();
  let clips: ReferenceClip[] = [];
  const client: IpcClient = {
    ...createMockClient(),
    recordingMode: "native",
    listClips: vi.fn(async () => clips),
    chooseClipFile: vi.fn(async () => ({ stagingId: "stage-1", fileName: "keynote.mp3", durationMs: 600_000 })),
    getClipStagingUrl: vi.fn(async () => "http://asset.localhost/full.wav"),
    discardClipStaging: vi.fn(async () => {}),
    saveClip: vi.fn(async () => { clips = [imported]; return imported; }),
    getClipPlaybackUrl: vi.fn(async () => "http://asset.localhost/clip.wav"),
    deleteClip: vi.fn(async () => { clips = []; }),
  };
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><ReferenceClips locked={false} native /></IpcContext.Provider></QueryClientProvider>);
  expect(await screen.findByText(/No clips yet/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Import a clip…" }));
  expect(screen.getByRole("group", { name: "Import a clip" })).toHaveTextContent("never uploaded");
  await user.click(screen.getByRole("button", { name: "Choose an audio file…" }));
  expect(await screen.findByText("keynote.mp3 · 10:00")).toBeInTheDocument();
  expect(screen.getByLabelText("Title")).toHaveValue("keynote");
  // Too long a section is refused before anything is saved.
  await user.clear(screen.getByLabelText("to"));
  await user.type(screen.getByLabelText("to"), "0:45");
  await user.click(screen.getByRole("button", { name: "Save clip" }));
  expect(screen.getByRole("alert")).toHaveTextContent("between 3 and 30 seconds");
  expect(client.saveClip).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText("Keep from"));
  await user.type(screen.getByLabelText("Keep from"), "1:00");
  await user.clear(screen.getByLabelText("to"));
  await user.type(screen.getByLabelText("to"), "1:12.5");
  await user.type(screen.getByLabelText("Source and credit"), "Speaker, Talk title, 2024");
  await user.click(screen.getByRole("button", { name: "Save clip" }));
  expect(client.saveClip).toHaveBeenCalledWith({ stagingId: "stage-1", startMs: 60_000, endMs: 72_500, title: "keynote", source: "Speaker, Talk title, 2024", transcript: null });
  expect(await screen.findByLabelText("Play clip: Opening of the talk")).toHaveAttribute("src", "http://asset.localhost/clip.wav");
  expect(screen.getByText("Source: Speaker, Talk title, 2024")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Delete clip Opening of the talk" }));
  await waitFor(() => expect(client.deleteClip).toHaveBeenCalledWith("clip-1"));
  expect(await screen.findByText(/No clips yet/)).toBeInTheDocument();
});

it("discards the staged copy when the import is cancelled", async () => {
  const user = userEvent.setup();
  const client: IpcClient = {
    ...createMockClient(), recordingMode: "native", listClips: async () => [],
    chooseClipFile: async () => ({ stagingId: "stage-2", fileName: "a.wav", durationMs: 20_000 }),
    getClipStagingUrl: async () => "http://asset.localhost/full.wav",
    discardClipStaging: vi.fn(async () => {}),
  };
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><ReferenceClips locked={false} native /></IpcContext.Provider></QueryClientProvider>);
  await user.click(await screen.findByRole("button", { name: "Import a clip…" }));
  await user.click(screen.getByRole("button", { name: "Choose an audio file…" }));
  await screen.findByText("a.wav · 0:20");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(client.discardClipStaging).toHaveBeenCalledWith("stage-2");
});
