import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { ClipFolder, ReferenceClip } from "@/lib/ipc/schemas";
import { ClipLibrary, filterClips } from "./ClipLibrary";

const clip = (id: string, over: Partial<ReferenceClip> = {}): ReferenceClip => ({
  id, origin: "user", title: id, source: "", transcript: null, description: null, feature: null, durationMs: 10_000, sha256: "a".repeat(64), createdAtMs: 1, folderId: null, ...over,
});

it("filters by folder, feature and words, and sorts (4.4h)", () => {
  const clips = [
    clip("voa-frost", { origin: "bundled", title: "The Story of Jack Frost", createdAtMs: 1, durationMs: 15_000, feature: "endings" }),
    clip("clip-a", { title: "Opening line", transcript: "Thank you all for coming", folderId: "folder-talks", createdAtMs: 3, durationMs: 8_000 }),
    clip("clip-b", { title: "Budget point", description: "Calm pace", createdAtMs: 2, durationMs: 20_000, feature: "rhythm" }),
  ];
  const ids = (f: Parameters<typeof filterClips>[1]) => filterClips(clips, f).map((c) => c.id);
  const base = { view: "all", query: "", feature: "any", sort: "newest" } as const;
  expect(ids(base)).toEqual(["clip-a", "clip-b", "voa-frost"]);
  expect(ids({ ...base, view: "bundled" })).toEqual(["voa-frost"]);
  expect(ids({ ...base, view: "unfiled" })).toEqual(["clip-b"]);
  expect(ids({ ...base, view: "folder-talks" })).toEqual(["clip-a"]);
  expect(ids({ ...base, query: "THANK coming" })).toEqual(["clip-a"]);
  expect(ids({ ...base, query: "calm" })).toEqual(["clip-b"]);
  expect(ids({ ...base, feature: "rhythm" })).toEqual(["clip-b"]);
  expect(ids({ ...base, sort: "title" })).toEqual(["clip-b", "clip-a", "voa-frost"]);
  expect(ids({ ...base, sort: "shortest" })).toEqual(["clip-a", "voa-frost", "clip-b"]);
  expect(ids({ ...base, sort: "longest" })).toEqual(["clip-b", "voa-frost", "clip-a"]);
});

it("organises clips in folders, moves a selection and chooses a clip to practise with", async () => {
  const user = userEvent.setup();
  let folders: ClipFolder[] = [];
  let clips = [
    clip("voa-frost", { origin: "bundled", title: "The Story of Jack Frost" }),
    clip("clip-a", { title: "Opening line", createdAtMs: 3 }),
    clip("clip-b", { title: "Budget point", createdAtMs: 2 }),
  ];
  const client: IpcClient = {
    ...createMockClient(),
    recordingMode: "native",
    listClips: async () => clips,
    listClipFolders: async () => folders,
    createClipFolder: vi.fn(async (name: string) => {
      const folder = { id: "folder-1", name, clipCount: 0, createdAtMs: 1 };
      folders = [folder];
      return folder;
    }),
    moveClips: vi.fn(async (ids: string[], folderId: string | null) => {
      clips = clips.map((c) => (ids.includes(c.id) ? { ...c, folderId } : c));
      folders = folders.map((f) => ({ ...f, clipCount: clips.filter((c) => c.folderId === f.id).length }));
    }),
    deleteClipFolder: vi.fn(async () => {
      clips = clips.map((c) => ({ ...c, folderId: null }));
      folders = [];
    }),
  };
  const onChoose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IpcContext.Provider value={client}>
        <ClipLibrary open onOpenChange={vi.fn()} chosenId="clip-a" onChoose={onChoose} onImport={vi.fn()} />
      </IpcContext.Provider>
    </QueryClientProvider>,
  );
  const nav = await screen.findByRole("navigation", { name: "Clip folders" });
  await waitFor(() => expect(within(nav).getByRole("button", { name: /All clips \(3\)/ })).toBeInTheDocument());
  expect(within(nav).getByRole("button", { name: /VOA Learning English \(1\)/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Practise with Opening line" })).toHaveTextContent("Chosen");

  await user.click(screen.getByRole("button", { name: "New folder" }));
  await user.type(screen.getByLabelText("Folder name"), "Talks");
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(client.createClipFolder).toHaveBeenCalledWith("Talks");
  expect(await screen.findByText("No clips here. Try another folder or search.")).toBeInTheDocument();

  await user.click(within(nav).getByRole("button", { name: /All clips/ }));
  await user.click(screen.getByRole("checkbox", { name: "Select Opening line" }));
  await user.click(screen.getByRole("checkbox", { name: "Select Budget point" }));
  await user.selectOptions(screen.getByLabelText("Move to"), "Talks");
  expect(client.moveClips).toHaveBeenCalledWith(["clip-a", "clip-b"], "folder-1");
  await waitFor(() => expect(within(nav).getByRole("button", { name: /Talks \(2\)/ })).toBeInTheDocument());

  await user.type(screen.getByLabelText("Search"), "budget");
  expect(screen.getByText("1 clip match")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Practise with Budget point" }));
  expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: "clip-b" }));

  // Deleting a folder keeps its clips.
  await user.clear(screen.getByLabelText("Search"));
  await user.click(within(nav).getByRole("button", { name: /Talks/ }));
  await user.click(screen.getByRole("button", { name: "Delete folder" }));
  expect(screen.getByText(/Its 2 clips stay, unfiled/)).toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "Delete folder" }).at(-1)!);
  expect(client.deleteClipFolder).toHaveBeenCalledWith("folder-1");
  await waitFor(() => expect(within(nav).getByRole("button", { name: /Unfiled \(2\)/ })).toBeInTheDocument());
});
