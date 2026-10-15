import { Link, useNavigate, useSearchParams } from "react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, CheckCheck, ChevronsUpDown, FileText, Heart, History, Loader2, NotebookPen, Search, Trash2, X } from "lucide-react";
import { EmptyState, LoadingBlock, Page, PageHeader, QueryView } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useIpc } from "@/lib/ipc";
import { useTranscriptionQueue } from "@/features/transcription/queue";
import { movedToTrash, useInvalidateHistory } from "./TrashPage";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatClock, formatDay } from "@/lib/format";
import { useSessions } from "@/lib/ipc/queries";
import { ExerciseType, type SessionSummary } from "@/lib/ipc/schemas";
import { cn } from "@/lib/utils";

export const EXERCISE_LABELS: Record<ExerciseType, string> = {
  repeat: "Repeat an answer",
  thought_groups: "Thought groups",
  imitate: "Listen and imitate",
  expression: "Better expression",
};

type SortKey = "title" | "date" | "duration" | "takes";
const SORTS: Record<SortKey, (a: SessionSummary, b: SessionSummary) => number> = {
  title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  date: (a, b) => a.startedAt.localeCompare(b.startedAt),
  duration: (a, b) => a.durationMs - b.durationMs,
  takes: (a, b) => a.attemptCount - b.attemptCount,
};

/** A column header that sorts; the arrow and aria-sort say which way (§3.10). */
function SortHeader({ label, column, sort, dir, onSort, numeric = false }: {
  label: string; column: SortKey; sort: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void; numeric?: boolean;
}) {
  const active = sort === column;
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  const icon = <Icon aria-hidden className={cn("size-3.5", !active && "opacity-50")} />;
  return (
    <th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} className={cn("px-2 py-1 font-medium", numeric && "text-right")}>
      {/* Numeric columns keep the label over the right-aligned numbers, so the arrow goes first. */}
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn("inline-flex h-8 items-center gap-1 rounded-md px-2 hover:bg-secondary hover:text-foreground", active && "text-foreground")}
      >
        {numeric && icon}
        {label}
        {!numeric && icon}
      </button>
    </th>
  );
}

/** Whether a session's takes have transcripts: all, some, none, or being transcribed now. */
function TranscriptStatus({ session, busy }: { session: SessionSummary; busy: boolean }) {
  if (busy)
    return (
      <span className="inline-flex items-center gap-1.5 text-meta text-primary">
        <Loader2 aria-hidden className="size-3.5 animate-spin" /> Transcribing
      </span>
    );
  const done = session.transcribedTakes;
  if (done === undefined || session.attemptCount === 0) return <span className="text-meta text-muted-foreground">—</span>;
  if (done >= session.attemptCount)
    return (
      <span className="inline-flex items-center gap-1.5 text-meta text-primary">
        <CheckCheck aria-hidden className="size-3.5" /> Transcribed
      </span>
    );
  if (done > 0)
    return (
      <span className="inline-flex h-5 items-center rounded-md bg-highlight px-1.5 text-meta text-highlight-foreground tabular-nums">
        {done} of {session.attemptCount}
      </span>
    );
  return <span className="text-meta text-muted-foreground">Not transcribed</span>;
}

/** Ticks every session shown, or none; "some" shows a dash. */
function SelectAll({ visible, picked, onChange }: { visible: SessionSummary[]; picked: Set<string>; onChange: (next: Set<string>) => void }) {
  const count = visible.filter((s) => picked.has(s.id)).length;
  return (
    <Checkbox
      aria-label="Select all sessions shown"
      checked={count === 0 ? false : count === visible.length ? true : "indeterminate"}
      onCheckedChange={(on) => onChange(on === true ? new Set(visible.map((s) => s.id)) : new Set())}
    />
  );
}

/**
 * Actions for the sessions you ticked (user request 2026-10-10): transcribe
 * every take on this computer, one after another, or move them all to Trash.
 */
function SelectionBar({ selected, onClear }: { selected: SessionSummary[]; onClear: () => void }) {
  const ipc = useIpc();
  const navigate = useNavigate();
  const queue = useTranscriptionQueue();
  const refresh = useInvalidateHistory();
  const [confirm, setConfirm] = useState(false);
  const untranscribed = selected.filter((s) => (s.transcribedTakes ?? 0) < s.attemptCount);
  const transcribe = useMutation({
    mutationFn: async () => {
      const details = await Promise.all(untranscribed.map((s) => ipc.getSession(s.id)));
      return details.flatMap((d) => d.attempts.filter((a) => !a.audioUnavailableReason).map((a) => ({ attemptId: a.id, sessionId: d.id })));
    },
    onSuccess: (items) => {
      const added = queue.enqueue(items);
      toast(
        added
          ? `Transcribing ${added} ${added === 1 ? "take" : "takes"} on this computer, one after another. You can keep using the app.`
          : "Every take in these sessions already has a transcript.",
      );
    },
  });
  const trash = useMutation({
    mutationFn: async () => {
      const moved: string[] = [];
      for (const s of selected) {
        await ipc.moveSessionToTrash(s.id);
        moved.push(s.id);
      }
      return moved;
    },
    onSettled: () => void refresh(),
    onSuccess: (moved) => {
      setConfirm(false);
      onClear();
      movedToTrash(`${moved.length} ${moved.length === 1 ? "session" : "sessions"}`, navigate, async () => {
        for (const id of moved) await ipc.restoreSession(id);
        await refresh();
        toast.success(`Restored ${moved.length} ${moved.length === 1 ? "session" : "sessions"}`);
      });
    },
  });
  const takes = selected.reduce((n, s) => n + s.attemptCount, 0);
  const error = transcribe.error ?? trash.error;
  return (
    <div role="region" aria-label="Selected sessions" className="sticky top-16 z-[5] mb-3 flex flex-wrap items-center gap-2 rounded-panel border bg-card px-4 py-2 shadow-sm">
      <span className="mr-2 font-medium tabular-nums">{selected.length} selected</span>
      <Button variant="outline" size="sm" disabled={!queue.available || untranscribed.length === 0 || transcribe.isPending} onClick={() => transcribe.mutate()}>
        <FileText aria-hidden /> {transcribe.isPending ? "Preparing…" : "Transcribe all takes"}
      </Button>
      <Button variant="ghost" size="sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirm(true)}>
        <Trash2 aria-hidden /> Move to Trash
      </Button>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        Clear selection
      </Button>
      {!queue.available && queue.unavailableReason && <p className="w-full text-meta text-muted-foreground">{queue.unavailableReason}</p>}
      {queue.available && untranscribed.length === 0 && <p className="w-full text-meta text-muted-foreground">Every take in the selected sessions already has a transcript.</p>}
      {error && <p role="alert" className="w-full text-meta text-destructive">{error.message}</p>}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Move {selected.length} {selected.length === 1 ? "session" : "sessions"} to Trash?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Their {takes} {takes === 1 ? "recording" : "recordings"}, transcripts and notes move with them. You can restore them from Trash until it is emptied.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={trash.isPending}
              onClick={(e) => {
                e.preventDefault();
                trash.mutate();
              }}
            >
              {trash.isPending ? "Moving…" : "Move to Trash"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function SessionsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get("q") ?? "";
  const type = params.get("type") as ExerciseType | null;
  const favoritesOnly = params.get("fav") === "1";
  // One day from the activity calendar (?date=YYYY-MM-DD).
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date") : null;
  const sort = (params.get("sort") as SortKey | null) ?? "date";
  const dir = params.get("dir") === "asc" ? "asc" : params.get("dir") === "desc" ? "desc" : sort === "title" ? "asc" : "desc";

  // Filters live in the URL so Back restores them (§3).
  const update = (fn: (p: URLSearchParams) => void) =>
    setParams(
      (p) => {
        fn(p);
        return p;
      },
      { replace: true },
    );

  const sessions = useSessions({ query: q || undefined, exerciseType: type ?? undefined, favoritesOnly });
  const queue = useTranscriptionQueue();
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const next = new Set(p);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  // Newest first by default; a second click on the same column reverses it.
  const onSort = (k: SortKey) =>
    update((p) => {
      const nextDir = k === sort ? (dir === "asc" ? "desc" : "asc") : k === "title" ? "asc" : "desc";
      if (k === "date" && nextDir === "desc") { p.delete("sort"); p.delete("dir"); } else { p.set("sort", k); p.set("dir", nextDir); }
    });
  const sorted = (list: SessionSummary[]) => {
    const compare = SORTS[sort] ?? SORTS.date;
    return list.filter((s) => !date || s.localDate === date).sort((a, b) => (dir === "asc" ? compare(a, b) : compare(b, a)));
  };

  return (
    <Page>
      <PageHeader
        title="Sessions"
        description="Everything you've recorded, stored on this computer. Click a column header to sort."
        actions={
          <Button data-tour="trash" variant="ghost" asChild>
            <Link to="/sessions/trash">
              <Trash2 aria-hidden /> Trash
            </Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search titles and notes"
            placeholder="Search titles and notes"
            className="h-10 pl-9"
            value={q}
            onChange={(e) => update((p) => (e.target.value ? p.set("q", e.target.value) : p.delete("q")))}
          />
        </div>
        <Select
          value={type ?? "all"}
          onValueChange={(v) => update((p) => (v === "all" ? p.delete("type") : p.set("type", v)))}
        >
          <SelectTrigger className="h-10 w-52" aria-label="Exercise">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All exercises</SelectItem>
            {ExerciseType.options.map((t) => (
              <SelectItem key={t} value={t}>
                {EXERCISE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={favoritesOnly ? "secondary" : "outline"}
          aria-pressed={favoritesOnly}
          onClick={() => update((p) => (favoritesOnly ? p.delete("fav") : p.set("fav", "1")))}
        >
          <Heart aria-hidden className={cn(favoritesOnly && "fill-current")} /> Favorites
        </Button>
        {date && (
          <Button variant="secondary" onClick={() => update((p) => p.delete("date"))} aria-label={`Showing ${formatDay(date)} only. Show all days`}>
            {formatDay(date)} <X aria-hidden />
          </Button>
        )}
      </div>

      <QueryView query={sessions} loading={<LoadingBlock rows={6} label="Loading sessions" />}>
        {(list) =>
          sorted(list).length === 0 ? (
            <EmptyState icon={History} title={q || type || favoritesOnly || date ? "No sessions match" : "No sessions yet"}>
              {q || type || favoritesOnly || date
                ? "Try clearing a filter."
                : "Sessions appear here after your first recording."}
            </EmptyState>
          ) : (
            <>
            {sorted(list).some((s) => picked.has(s.id)) && (
              <SelectionBar selected={sorted(list).filter((s) => picked.has(s.id))} onClear={() => setPicked(new Set())} />
            )}
            <div data-tour="sessions-table" className="overflow-x-auto rounded-panel border bg-card">
              <table className="w-full text-left">
                <caption className="sr-only">Practice sessions</caption>
                <thead className="border-b text-meta text-muted-foreground">
                  <tr>
                    <th scope="col" className="w-10 py-1 pl-4">
                      <SelectAll visible={sorted(list)} picked={picked} onChange={setPicked} />
                    </th>
                    <SortHeader label="Title" column="title" sort={sort} dir={dir} onSort={onSort} />
                    <SortHeader label="Date" column="date" sort={sort} dir={dir} onSort={onSort} />
                    <th scope="col" className="hidden px-4 py-2 font-medium lg:table-cell">Exercise</th>
                    <SortHeader label="Duration" column="duration" sort={sort} dir={dir} onSort={onSort} numeric />
                    <SortHeader label="Takes" column="takes" sort={sort} dir={dir} onSort={onSort} numeric />
                    <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Transcript</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sorted(list).map((s) => (
                    <tr
                      key={s.id}
                      className={cn("cursor-pointer hover:bg-secondary/60", picked.has(s.id) && "bg-secondary/40")}
                      onClick={() => navigate(`/sessions/${s.id}`)}
                    >
                      <td className="w-10 py-2.5 pl-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox aria-label={`Select ${s.title}`} checked={picked.has(s.id)} onCheckedChange={(on) => toggle(s.id, on === true)} />
                      </td>
                      <td className="px-4 py-2.5">
                        <Link to={`/sessions/${s.id}`} className="inline-flex items-center gap-2 font-medium hover:underline">
                          {s.title}
                        </Link>
                        <span className="ml-2 inline-flex gap-1 align-middle text-muted-foreground">
                          {s.favorite && <Heart aria-label="Favorite" className="size-3.5 fill-primary text-primary" />}
                          {s.hasNote && <NotebookPen aria-label="Has a note" className="size-3.5" />}
                        </span>
                        {s.tags.length > 0 && (
                          <span className="ml-2 text-meta text-muted-foreground">{s.tags.map((t) => `#${t}`).join(" ")}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{formatDay(s.localDate)}</td>
                      <td className="hidden px-4 py-2.5 whitespace-nowrap text-muted-foreground lg:table-cell">{s.exerciseType ? EXERCISE_LABELS[s.exerciseType] : "Recording · exercise unavailable"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatClock(s.durationMs)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{s.attemptCount}</td>
                      <td className="hidden px-4 py-2.5 whitespace-nowrap md:table-cell"><TranscriptStatus session={s} busy={queue.busySession(s.id)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )
        }
      </QueryView>
    </Page>
  );
}
