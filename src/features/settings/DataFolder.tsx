import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIpc } from "@/lib/ipc";

const size = (bytes: number) => (bytes >= 1_073_741_824 ? `${(bytes / 1_073_741_824).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1_048_576).toFixed(1)} MB`);

/**
 * Where ClearPractice keeps its data (2.25): shows the folder in use, moves the
 * data to another folder or drive (copied and checked, then the app restarts on
 * it), and removes the old copy once the user is happy.
 */
export function DataFolder() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const native = ipc.recordingMode === "native";
  const status = useQuery({ queryKey: ["data-location"], queryFn: () => ipc.getDataLocation(), enabled: native, retry: false });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    if (!native) return;
    let remove: (() => void) | undefined;
    let disposed = false;
    void ipc.onDataMoveProgress((p) => setProgress(p)).then((u) => (disposed ? u() : (remove = u))).catch(() => {});
    return () => { disposed = true; remove?.(); };
  }, [ipc, native]);
  const move = useMutation({
    mutationFn: (toDefault: boolean) => ipc.moveDataFolder(toDefault),
    onMutate: () => setProgress(null),
    onSuccess: (target) => {
      if (!target) return;
      setMoved(target);
      // Everything that holds the old folder restarts with the new one.
      window.setTimeout(() => void ipc.restartApp().catch(() => {}), 1_500);
    },
    onSettled: () => setProgress(null),
  });
  const removeOld = useMutation({
    mutationFn: () => ipc.removeOldDataCopy(),
    onSuccess: async () => { setConfirmRemove(false); await qc.invalidateQueries({ queryKey: ["data-location"] }); },
  });

  if (!native) return <code>%LOCALAPPDATA%\com.clearpractice.app</code>;
  const s = status.data;
  return (
    <div className="space-y-2">
      <p><code className="break-all">{s?.current ?? "…"}</code>{s && !s.custom && <span className="text-meta text-muted-foreground"> (default)</span>}</p>
      {s?.problem && <p role="alert" className="text-meta text-destructive">{s.problem}</p>}
      {moved ? (
        <p role="status" className="text-meta">Copied and checked to {moved}. ClearPractice restarts now and uses the new folder.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={move.isPending} onClick={() => move.mutate(false)}>
            <FolderInput aria-hidden /> Move data folder…
          </Button>
          {s?.custom && (
            <Button variant="ghost" size="sm" disabled={move.isPending} onClick={() => move.mutate(true)}>Move back to the default folder</Button>
          )}
        </div>
      )}
      <p className="text-meta text-muted-foreground">
        Moves recordings, clips, transcripts and settings to a folder you choose, for example on drive D:. Every file is copied and checked before the app switches; the old copy stays until you remove it.
      </p>
      {move.isPending && (
        <div role="status" aria-label="Data move progress" className="space-y-1 text-meta">
          <progress className="h-2 w-full max-w-md" max={progress?.total || undefined} value={progress?.total ? progress.done : undefined} />
          <p>
            {progress?.total ? `Copying and checking… ${Math.floor((progress.done / progress.total) * 100)}% of ${size(progress.total / 2)}` : "Choose a folder, then copying starts…"}
            {progress && <Button variant="ghost" size="sm" onClick={() => void ipc.cancelClipWork()}>Stop</Button>}
          </p>
        </div>
      )}
      {move.error && <p role="alert" className="text-meta text-destructive">{move.error.message}</p>}
      {s?.previous && (
        <div className="space-y-1 rounded-md border p-2 text-meta">
          <p>An older copy of your data ({size(s.previousBytes)}) is still in <code className="break-all">{s.previous}</code>.</p>
          {confirmRemove ? (
            <p className="flex flex-wrap items-center gap-2">
              Remove the old copy? The data in use is not touched.
              <Button size="sm" variant="destructive" disabled={removeOld.isPending} onClick={() => removeOld.mutate()}>Remove old copy</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>Keep it</Button>
            </p>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setConfirmRemove(true)}>Remove old copy…</Button>
          )}
          {removeOld.error && <p role="alert" className="text-destructive">{removeOld.error.message}</p>}
        </div>
      )}
    </div>
  );
}
