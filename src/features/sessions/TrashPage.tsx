import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcw, Trash2 } from "lucide-react";
import { EmptyState, LoadingBlock, Page, PageHeader, QueryView } from "@/components/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatClock, formatDay, UI_LOCALE } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import {
  TRASH_RETENTION_CHOICES,
  TrashRetentionDays,
  type PurgeOutcome,
  type SessionSummary,
  type TrashItem,
  type TrashTake,
} from "@/lib/ipc/schemas";

const trashKey = ["trash"] as const;
const PENDING_FILES =
  "Removed from Trash. Some files were in use; ClearPractice removes them the next time it starts.";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(UI_LOCALE, { day: "numeric", month: "short", year: "numeric" });

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function takes(count: number) {
  return `${count} ${count === 1 ? "recording" : "recordings"}`;
}

function useTrash() {
  const ipc = useIpc();
  return useQuery({ queryKey: trashKey, queryFn: () => ipc.listTrash() });
}

function useInvalidateHistory() {
  const qc = useQueryClient();
  return async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: trashKey }),
      qc.invalidateQueries({ queryKey: ["sessions"] }),
      qc.invalidateQueries({ queryKey: ["session"] }),
      qc.invalidateQueries({ queryKey: ["recordings"] }),
      qc.invalidateQueries({ queryKey: ["recording-recovery"] }),
    ]);
  };
}

/**
 * Move to Trash with a dialog that states exactly what moves (§6 Sessions):
 * the session, its recordings, and the copies derived from them.
 */
export function MoveToTrashButton({ session }: { session: Pick<SessionSummary, "id" | "title" | "attemptCount" | "durationMs"> }) {
  const ipc = useIpc();
  const navigate = useNavigate();
  const refresh = useInvalidateHistory();
  const retention = useTrash().data?.retentionDays ?? 30;
  const [open, setOpen] = useState(false);
  const restore = async () => {
    try {
      await ipc.restoreSession(session.id);
      await refresh();
      toast.success(`Restored “${session.title}”`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The session could not be restored.");
    }
  };
  const move = useMutation({
    mutationFn: () => ipc.moveSessionToTrash(session.id),
    onSuccess: async () => {
      // Leave the session page before its query is invalidated, so it never flashes "unavailable".
      setOpen(false);
      navigate("/sessions");
      await refresh();
      toast(`Moved “${session.title}” to Trash`, { duration: 10_000, action: { label: "Undo", onClick: () => void restore() } });
    },
  });
  return (
    <AlertDialog open={open} onOpenChange={(next) => { setOpen(next); move.reset(); }}>
      <AlertDialogTrigger asChild>
        {/* Quiet until hovered: a destructive action never competes with the screen's primary (§3.4). */}
        <Button variant="ghost" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
          <Trash2 aria-hidden /> Move to Trash
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Move “{session.title}” to Trash?</AlertDialogTitle>
          <AlertDialogDescription>
            This includes {takes(session.attemptCount)} ({formatClock(session.durationMs)} of audio), your notes, and the
            waveform and transcription-ready copies made from the audio. Nothing is deleted now. You can restore it from
            Trash for {retention} {retention === 1 ? "day" : "days"}; after that it is deleted permanently.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {move.error && <p role="alert" className="text-meta text-destructive">{move.error.message}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep session</AlertDialogCancel>
          <AlertDialogAction
            disabled={move.isPending}
            onClick={(event) => {
              event.preventDefault();
              move.mutate();
            }}
          >
            {move.isPending ? "Moving…" : "Move to Trash"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Move one saved take to Trash (2.23). The dialog names the take and its length;
 * the session, its notes and the other takes stay, and the toast offers Undo.
 */
export function MoveTakeToTrashButton({ take, sessionTitle, onMoved, onRestored }: {
  take: { id: string; ordinal: number; durationMs: number };
  sessionTitle: string;
  onMoved?: () => void;
  onRestored?: () => void;
}) {
  const ipc = useIpc();
  const refresh = useInvalidateHistory();
  const retention = useTrash().data?.retentionDays ?? 30;
  const [open, setOpen] = useState(false);
  const label = `Take ${take.ordinal} (${formatClock(take.durationMs)})`;
  const restore = async () => {
    try {
      await ipc.restoreTake(take.id);
      await refresh();
      onRestored?.();
      toast.success(`Restored ${label}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The take could not be restored.");
    }
  };
  const move = useMutation({
    mutationFn: () => ipc.moveTakeToTrash(take.id),
    onSuccess: async () => {
      setOpen(false);
      onMoved?.();
      await refresh();
      toast(`Moved ${label} to Trash`, { duration: 10_000, action: { label: "Undo", onClick: () => void restore() } });
    },
  });
  return (
    <AlertDialog open={open} onOpenChange={(next) => { setOpen(next); move.reset(); }}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Move take ${take.ordinal} to Trash`}>
          <Trash2 aria-hidden /> Move take to Trash
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Move {label} to Trash?</AlertDialogTitle>
          <AlertDialogDescription>
            This take of “{sessionTitle}” moves to Trash with its transcripts, measures and intonation. The session, its notes and
            the other takes stay, and they keep their numbers. You can restore it from Trash for {retention} {retention === 1 ? "day" : "days"};
            after that it is deleted permanently.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {move.error && <p role="alert" className="text-meta text-destructive">{move.error.message}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep take</AlertDialogCancel>
          <AlertDialogAction
            disabled={move.isPending}
            onClick={(event) => {
              event.preventDefault();
              move.mutate();
            }}
          >
            {move.isPending ? "Moving…" : "Move to Trash"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmDelete({
  trigger,
  title,
  description,
  confirm,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirm: string;
  onConfirm: () => Promise<PurgeOutcome>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={(next) => { setOpen(next); setError(null); }}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert" className="text-meta text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={async (event) => {
              event.preventDefault();
              setPending(true);
              try {
                const outcome = await onConfirm();
                setOpen(false);
                if (outcome.filesPending) toast.warning(PENDING_FILES);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Nothing was deleted. Please try again.");
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "Deleting…" : confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function TrashPage() {
  const ipc = useIpc();
  const trash = useTrash();
  const refresh = useInvalidateHistory();
  const retention = useMutation({
    mutationFn: (days: TrashRetentionDays) => ipc.setTrashRetention(days),
    onSuccess: refresh,
  });
  const restore = useMutation({
    mutationFn: (item: TrashItem) => ipc.restoreSession(item.id),
    onSuccess: async (_, item) => {
      await refresh();
      toast.success(`Restored “${item.title}”`);
    },
  });
  const restoreTake = useMutation({
    mutationFn: (take: TrashTake) => ipc.restoreTake(take.id),
    onSuccess: async (_, take) => {
      await refresh();
      toast.success(`Restored take ${take.ordinal} of “${take.sessionTitle}”`);
    },
  });
  const purge = async (run: () => Promise<PurgeOutcome>) => {
    const outcome = await run();
    await refresh();
    return outcome;
  };

  return (
    <Page>
      <PageHeader
        title="Trash"
        description="Sessions and single takes you moved to Trash, with their recordings. Restore anything you want to keep."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/sessions">Back to sessions</Link>
            </Button>
            {!!(trash.data?.items.length || trash.data?.takes.length) && (
              <ConfirmDelete
                trigger={<Button variant="destructive"><Trash2 aria-hidden /> Empty Trash</Button>}
                title="Delete everything in Trash permanently?"
                description={`${trash.data.items.length} ${trash.data.items.length === 1 ? "session" : "sessions"} with ${takes(trash.data.items.reduce((n, i) => n + i.attemptCount, 0))}${trash.data.takes.length ? ` and ${takes(trash.data.takes.length)} from other sessions` : ""} will be deleted from this computer, including the original audio, notes and derived copies. This cannot be undone. Backups you made earlier are not changed.`}
                confirm="Delete permanently"
                onConfirm={() => purge(() => ipc.emptyTrash())}
              />
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span id="retention-label" className="text-meta text-muted-foreground">Delete permanently after</span>
        <Select
          value={String(trash.data?.retentionDays ?? 30)}
          disabled={!trash.data || retention.isPending}
          onValueChange={(v) => retention.mutate(TrashRetentionDays.parse(Number(v)))}
        >
          <SelectTrigger className="h-10 w-32" aria-labelledby="retention-label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRASH_RETENTION_CHOICES.map((d) => (
              <SelectItem key={d} value={String(d)}>{d} {d === 1 ? "day" : "days"}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-meta text-muted-foreground">Expired items are deleted the next time ClearPractice starts.</span>
      </div>
      {retention.error && <p role="alert" className="mb-4 text-meta text-destructive">{retention.error.message}</p>}
      {restore.error && <p role="alert" className="mb-4 text-meta text-destructive">{restore.error.message}</p>}
      {restoreTake.error && <p role="alert" className="mb-4 text-meta text-destructive">{restoreTake.error.message}</p>}

      <QueryView query={trash} loading={<LoadingBlock rows={3} label="Loading Trash" />}>
        {({ items, takes: trashedTakes }) =>
          items.length === 0 && trashedTakes.length === 0 ? (
            <EmptyState icon={Trash2} title="Trash is empty">Sessions and takes you move to Trash appear here.</EmptyState>
          ) : (
            <div className="space-y-6">
            {items.length > 0 && <div className="overflow-x-auto rounded-panel border bg-card">
              <table className="w-full text-left">
                <caption className="sr-only">Sessions in Trash</caption>
                <thead className="border-b text-meta text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">Session</th>
                    <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Recordings</th>
                    <th scope="col" className="px-4 py-2 font-medium">Deleted permanently</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{item.title}</p>
                        <p className="text-meta text-muted-foreground">
                          {formatDay(item.localDate)} · moved to Trash {formatDate(item.deletedAt)}
                        </p>
                      </td>
                      <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">
                        {takes(item.attemptCount)} · <span className="tabular-nums">{formatClock(item.durationMs)}</span>
                        {item.audioBytes > 0 && <> · {formatBytes(item.audioBytes)}</>}
                        {item.unsavedTakeCount > 0 && <> · {item.unsavedTakeCount} interrupted</>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">after {formatDate(item.purgeAt)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            disabled={restore.isPending}
                            onClick={() => restore.mutate(item)}
                            aria-label={`Restore ${item.title}`}
                          >
                            <RotateCcw aria-hidden /> Restore
                          </Button>
                          <ConfirmDelete
                            trigger={<Button variant="ghost" aria-label={`Delete ${item.title} permanently`}><Trash2 aria-hidden /> Delete</Button>}
                            title={`Delete “${item.title}” permanently?`}
                            description={`${takes(item.attemptCount)} (${formatClock(item.durationMs)} of audio), notes and derived copies will be deleted from this computer. This cannot be undone. Backups you made earlier are not changed.`}
                            confirm="Delete permanently"
                            onConfirm={() => purge(() => ipc.deleteSessionsPermanently([item.id]))}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
            {trashedTakes.length > 0 && (
              <div className="overflow-x-auto rounded-panel border bg-card">
                <table className="w-full text-left">
                  <caption className="px-4 pt-3 text-left font-medium">Single takes</caption>
                  <thead className="border-b text-meta text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-medium">Take</th>
                      <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Recording</th>
                      <th scope="col" className="px-4 py-2 font-medium">Deleted permanently</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {trashedTakes.map((take) => (
                      <tr key={take.id}>
                        <td className="px-4 py-2.5">
                          <p className="font-medium">Take {take.ordinal} of “{take.sessionTitle}”</p>
                          <p className="text-meta text-muted-foreground">moved to Trash {formatDate(take.deletedAt)}</p>
                        </td>
                        <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">
                          <span className="tabular-nums">{formatClock(take.durationMs)}</span>
                          {take.audioBytes > 0 && <> · {formatBytes(take.audioBytes)}</>}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">after {formatDate(take.purgeAt)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              disabled={restoreTake.isPending}
                              onClick={() => restoreTake.mutate(take)}
                              aria-label={`Restore take ${take.ordinal} of ${take.sessionTitle}`}
                            >
                              <RotateCcw aria-hidden /> Restore
                            </Button>
                            <ConfirmDelete
                              trigger={<Button variant="ghost" aria-label={`Delete take ${take.ordinal} of ${take.sessionTitle} permanently`}><Trash2 aria-hidden /> Delete</Button>}
                              title={`Delete take ${take.ordinal} of “${take.sessionTitle}” permanently?`}
                              description={`Its audio (${formatClock(take.durationMs)}), transcripts, measures, intonation and cloud results will be deleted from this computer. The session and its other takes stay. This cannot be undone. Backups you made earlier are not changed.`}
                              confirm="Delete permanently"
                              onConfirm={() => purge(() => ipc.deleteTakesPermanently([take.id]))}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </div>
          )
        }
      </QueryView>
    </Page>
  );
}
