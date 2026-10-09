import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileAudio, Folder, FolderOpen, FolderPlus, Library, Pause, Pencil, Play, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatClock } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import type { ClipFolder, ReferenceClip } from "@/lib/ipc/schemas";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";

export type Feature = "emphasis" | "rhythm" | "endings";
export const FEATURE_LABELS: Record<Feature, string> = { emphasis: "Emphasis", rhythm: "Phrase rhythm", endings: "Clear endings" };

/** "all", "bundled", "unfiled" or a folder ID. */
export type LibraryView = string;
export type LibrarySort = "newest" | "title" | "shortest" | "longest";
export type LibraryFilter = { view: LibraryView; query: string; feature: Feature | "any"; sort: LibrarySort };

/** Filters and sorts the library (4.4h). Search covers title, description, transcript and credit. */
export function filterClips(clips: ReferenceClip[], f: LibraryFilter): ReferenceClip[] {
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  const out = clips.filter((c) => {
    if (f.view === "bundled" && c.origin !== "bundled") return false;
    if (f.view === "unfiled" && (c.origin === "bundled" || c.folderId)) return false;
    if (f.view !== "all" && f.view !== "bundled" && f.view !== "unfiled" && c.folderId !== f.view) return false;
    if (f.feature !== "any" && c.feature !== f.feature) return false;
    const text = [c.title, c.description, c.transcript, c.source].filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => text.includes(w));
  });
  const byTitle = (a: ReferenceClip, b: ReferenceClip) => a.title.localeCompare(b.title, "en", { sensitivity: "base" });
  const sorters: Record<LibrarySort, (a: ReferenceClip, b: ReferenceClip) => number> = {
    newest: (a, b) => b.createdAtMs - a.createdAtMs || byTitle(a, b),
    title: byTitle,
    shortest: (a, b) => a.durationMs - b.durationMs || byTitle(a, b),
    longest: (a, b) => b.durationMs - a.durationMs || byTitle(a, b),
  };
  return out.sort(sorters[f.sort]);
}

function ClipRow({ clip, folders, chosen, checked, playing, onCheck, onPlay, onChoose }: {
  clip: ReferenceClip;
  folders: ClipFolder[];
  chosen: boolean;
  checked: boolean;
  playing: boolean;
  onCheck: (on: boolean) => void;
  onPlay: () => void;
  onChoose: () => void;
}) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState(clip.title);
  const [description, setDescription] = useState(clip.description ?? "");
  const [feature, setFeature] = useState<Feature | "">(clip.feature ?? "");
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["clips"] }), qc.invalidateQueries({ queryKey: ["clip-folders"] })]);
  const save = useMutation({
    mutationFn: () => ipc.updateClip(clip.id, { title: title.trim(), description: description.trim() || null, feature: feature || null }),
    onSuccess: async () => { setEditing(false); await refresh(); },
  });
  const move = useMutation({ mutationFn: (folder: string | null) => ipc.moveClips([clip.id], folder), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => ipc.deleteClip(clip.id), onSuccess: refresh });
  const folderName = clip.origin === "bundled" && !clip.folderId ? "VOA Learning English" : folders.find((f) => f.id === clip.folderId)?.name ?? "Unfiled";
  const error = save.error ?? move.error ?? remove.error;

  return (
    <li className={cn("space-y-2 rounded-md border p-2", chosen && "border-primary bg-secondary/40")}>
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox aria-label={`Select ${clip.title}`} checked={checked} onCheckedChange={(v) => onCheck(v === true)} />
        <Button variant="ghost" size="sm" aria-label={`${playing ? "Pause" : "Play"} ${clip.title}`} onClick={onPlay}>
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
        <div className="min-w-48 flex-1">
          <p className="font-medium">{clip.title}</p>
          <p className="text-meta text-muted-foreground">
            {formatClock(clip.durationMs)}
            {clip.feature && ` · ${FEATURE_LABELS[clip.feature]}`}
            {` · ${folderName}`}
            {clip.origin === "user" ? " · yours" : ""}
          </p>
        </div>
        <Button size="sm" variant={chosen ? "secondary" : "outline"} onClick={onChoose} aria-label={`Practise with ${clip.title}`}>
          {chosen ? <><Check aria-hidden /> Chosen</> : "Practise with this"}
        </Button>
        <Button variant="ghost" size="sm" aria-label={`Edit ${clip.title}`} onClick={() => setEditing((e) => !e)}><Pencil aria-hidden /></Button>
      </div>
      {clip.description && !editing && <p className="text-meta">{clip.description}</p>}
      {editing && (
        <form
          className="space-y-2 rounded-md bg-secondary/40 p-2"
          onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`title-${clip.id}`}>Title</Label>
              <Input id={`title-${clip.id}`} className="h-9" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`feature-${clip.id}`}>Listen for</Label>
              <NativeSelect id={`feature-${clip.id}`} compact className="w-full" value={feature} onChange={(e) => setFeature(e.target.value as Feature | "")}>
                <option value="">Not set</option>
                {(Object.keys(FEATURE_LABELS) as Feature[]).map((f) => <option key={f} value={f}>{FEATURE_LABELS[f]}</option>)}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`description-${clip.id}`}>Description</Label>
            <Input id={`description-${clip.id}`} className="h-9" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={save.isPending || !title.trim()}>Save</Button>
            <Label htmlFor={`move-${clip.id}`} className="text-meta">Folder</Label>
            <NativeSelect
              id={`move-${clip.id}`}
              compact
              value={clip.folderId ?? ""}
              disabled={move.isPending}
              onChange={(e) => move.mutate(e.target.value || null)}
            >
              <option value="">{clip.origin === "bundled" ? "VOA Learning English" : "Unfiled"}</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </NativeSelect>
            {clip.origin === "user" && !confirmDelete && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}><Trash2 aria-hidden /> Delete clip</Button>
            )}
            {confirmDelete && (
              <span className="flex items-center gap-2 text-meta">
                Delete “{clip.title}” and its audio?
                <Button type="button" variant="destructive" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Keep</Button>
              </span>
            )}
          </div>
          <p className="text-meta text-muted-foreground">Source: {clip.source || "not given"}</p>
        </form>
      )}
      {error && <p role="alert" className="text-meta text-destructive">{error.message}</p>}
    </li>
  );
}

/**
 * The clip library (4.4h): a window with folders on the left and the clips in
 * the chosen folder on the right, with search, a feature filter, sorting,
 * preview playback, editing, filing and deleting. Bundled VOA clips have their
 * own folder; clips you import start in the folder you save them to.
 */
export function ClipLibrary({ open, onOpenChange, chosenId, onChoose, onImport }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chosenId: string | null;
  onChoose: (clip: ReferenceClip) => void;
  onImport: () => void;
}) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const clips = useQuery({ queryKey: ["clips"], queryFn: () => ipc.listClips(), retry: false });
  const folders = useQuery({ queryKey: ["clip-folders"], queryFn: () => ipc.listClipFolders(), retry: false });
  const [filter, setFilter] = useState<LibraryFilter>({ view: "all", query: "", feature: "any", sort: "newest" });
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmFolderDelete, setConfirmFolderDelete] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const list = clips.data ?? [];
  const folderList = folders.data ?? [];
  const shown = useMemo(() => filterClips(list, filter), [list, filter]);
  const counts = {
    all: list.length,
    bundled: list.filter((c) => c.origin === "bundled").length,
    unfiled: list.filter((c) => c.origin !== "bundled" && !c.folderId).length,
  };
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["clips"] }), qc.invalidateQueries({ queryKey: ["clip-folders"] })]);
  const create = useMutation({
    mutationFn: (name: string) => ipc.createClipFolder(name),
    onSuccess: async (folder) => { setNewFolder(null); setFilter((f) => ({ ...f, view: folder.id })); await refresh(); },
  });
  const rename = useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => ipc.renameClipFolder(id, name), onSuccess: async () => { setRenaming(null); await refresh(); } });
  const removeFolder = useMutation({
    mutationFn: (id: string) => ipc.deleteClipFolder(id),
    onSuccess: async () => { setConfirmFolderDelete(false); setFilter((f) => ({ ...f, view: "all" })); await refresh(); },
  });
  const moveChecked = useMutation({
    mutationFn: (folder: string | null) => ipc.moveClips([...checked], folder),
    onSuccess: async () => { setChecked(new Set()); await refresh(); },
  });
  const current = folderList.find((f) => f.id === filter.view);
  const error = create.error ?? rename.error ?? removeFolder.error ?? moveChecked.error ?? clips.error ?? folders.error;

  const play = async (clip: ReferenceClip) => {
    const el = audio.current;
    if (!el) return;
    if (playing === clip.id) { el.pause(); setPlaying(null); return; }
    try {
      el.src = await ipc.getClipPlaybackUrl(clip.id);
      el.preservesPitch = true;
      await el.play();
      setPlaying(clip.id);
    } catch { setPlaying(null); }
  };
  const views: { id: LibraryView; label: string; count: number; icon: typeof Folder }[] = [
    { id: "all", label: "All clips", count: counts.all, icon: Library },
    { id: "bundled", label: "VOA Learning English", count: counts.bundled, icon: Folder },
    { id: "unfiled", label: "Unfiled", count: counts.unfiled, icon: Folder },
    ...folderList.map((f) => ({ id: f.id, label: f.name, count: f.clipCount, icon: Folder })),
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { audio.current?.pause(); setPlaying(null); } onOpenChange(next); }}>
      <DialogContent className="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)] sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Clip library</DialogTitle>
          <DialogDescription>Choose a clip to imitate. Organise your clips in folders; bundled VOA clips have their own.</DialogDescription>
        </DialogHeader>
        <audio ref={audio} hidden onEnded={() => setPlaying(null)} />
        <div className="grid min-h-0 gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
          <nav aria-label="Clip folders" className="min-h-0 space-y-1 overflow-y-auto">
            {views.map((v) => {
              const Icon = filter.view === v.id ? FolderOpen : v.icon;
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-current={filter.view === v.id ? "true" : undefined}
                  aria-label={`${v.label} (${v.count})`}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-secondary", filter.view === v.id && "bg-secondary font-medium")}
                  onClick={() => { setFilter((f) => ({ ...f, view: v.id })); setRenaming(null); setConfirmFolderDelete(false); }}
                >
                  <Icon aria-hidden className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{v.label}</span>
                  <span className="text-meta tabular-nums text-muted-foreground">{v.count}</span>
                </button>
              );
            })}
            {newFolder === null ? (
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setNewFolder("")}><FolderPlus aria-hidden /> New folder</Button>
            ) : (
              <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); create.mutate(newFolder); }}>
                <Label htmlFor="new-folder" className="text-meta">Folder name</Label>
                <Input id="new-folder" className="h-9" maxLength={80} autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)} />
                <div className="flex gap-1">
                  <Button type="submit" size="sm" disabled={!newFolder.trim() || create.isPending}>Create</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setNewFolder(null)}>Cancel</Button>
                </div>
              </form>
            )}
          </nav>

          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1 space-y-1">
                <Label htmlFor="clip-search" className="text-meta">Search</Label>
                <div className="relative">
                  <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="clip-search" className="pl-8" placeholder="Title, description, transcript or credit" value={filter.query} onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="clip-feature" className="text-meta">Listen for</Label>
                <NativeSelect id="clip-feature" value={filter.feature} onChange={(e) => setFilter((f) => ({ ...f, feature: e.target.value as Feature | "any" }))}>
                  <option value="any">Any feature</option>
                  {(Object.keys(FEATURE_LABELS) as Feature[]).map((f) => <option key={f} value={f}>{FEATURE_LABELS[f]}</option>)}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="clip-sort" className="text-meta">Sort</Label>
                <NativeSelect id="clip-sort" value={filter.sort} onChange={(e) => setFilter((f) => ({ ...f, sort: e.target.value as LibrarySort }))}>
                  <option value="newest">Newest first</option>
                  <option value="title">Title A–Z</option>
                  <option value="shortest">Shortest first</option>
                  <option value="longest">Longest first</option>
                </NativeSelect>
              </div>
              <Button variant="outline" onClick={onImport}><FileAudio aria-hidden /> Import clips…</Button>
            </div>

            {current && (
              <div className="flex flex-wrap items-center gap-2 text-meta">
                {renaming === null ? (
                  <>
                    <span className="font-medium">{current.name}</span>
                    <Button variant="ghost" size="sm" onClick={() => setRenaming(current.name)}>Rename folder</Button>
                    {!confirmFolderDelete ? (
                      <Button variant="ghost" size="sm" onClick={() => setConfirmFolderDelete(true)}>Delete folder</Button>
                    ) : (
                      <span className="flex items-center gap-2">
                        Delete “{current.name}”? Its {current.clipCount} {current.clipCount === 1 ? "clip stays" : "clips stay"}, unfiled.
                        <Button variant="destructive" size="sm" disabled={removeFolder.isPending} onClick={() => removeFolder.mutate(current.id)}>Delete folder</Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmFolderDelete(false)}>Keep</Button>
                      </span>
                    )}
                  </>
                ) : (
                  <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); rename.mutate({ id: current.id, name: renaming }); }}>
                    <Label htmlFor="rename-folder" className="sr-only">New folder name</Label>
                    <Input id="rename-folder" className="h-9 w-56" maxLength={80} autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} />
                    <Button type="submit" size="sm" disabled={!renaming.trim() || rename.isPending}>Rename</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(null)}>Cancel</Button>
                  </form>
                )}
              </div>
            )}

            {checked.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-secondary/50 p-2 text-meta" role="group" aria-label="Selected clips">
                {checked.size} selected
                <Label htmlFor="move-selected" className="text-meta">Move to</Label>
                <NativeSelect
                  id="move-selected"
                  compact
                  value=""
                  disabled={moveChecked.isPending}
                  onChange={(e) => e.target.value && moveChecked.mutate(e.target.value === "-" ? null : e.target.value)}
                >
                  <option value="">Choose a folder…</option>
                  <option value="-">No folder</option>
                  {folderList.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </NativeSelect>
                <Button variant="ghost" size="sm" onClick={() => setChecked(new Set())}>Clear selection</Button>
              </div>
            )}
            {error && <p role="alert" className="text-meta text-destructive">{error.message}</p>}

            <p className="text-meta text-muted-foreground" aria-live="polite">
              {shown.length} {shown.length === 1 ? "clip" : "clips"}{filter.query || filter.feature !== "any" ? " match" : ""}
            </p>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" aria-label="Clips">
              {shown.map((clip) => (
                <ClipRow
                  key={clip.id}
                  clip={clip}
                  folders={folderList}
                  chosen={clip.id === chosenId}
                  checked={checked.has(clip.id)}
                  playing={playing === clip.id}
                  onCheck={(on) => setChecked((s) => { const next = new Set(s); if (on) next.add(clip.id); else next.delete(clip.id); return next; })}
                  onPlay={() => void play(clip)}
                  onChoose={() => { audio.current?.pause(); setPlaying(null); onChoose(clip); }}
                />
              ))}
              {shown.length === 0 && (
                <li className="rounded-md border border-dashed p-4 text-center text-meta text-muted-foreground">
                  {list.length === 0 ? "No clips yet. Import a recording to cut clips from it." : "No clips here. Try another folder or search."}
                </li>
              )}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
