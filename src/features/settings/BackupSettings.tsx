import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UI_LOCALE } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import type { BackupSummary, RestorePreview } from "@/lib/ipc/schemas";
import { formatBytes } from "@/features/sessions/TrashPage";

const statusKey = ["backup-status"] as const;
const when = (value: string | number) =>
  new Date(value).toLocaleString(UI_LOCALE, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function savedMessage(summary: BackupSummary) {
  const missing = summary.unavailableRecordings
    ? ` ${count(summary.unavailableRecordings, "recording")} ${summary.unavailableRecordings === 1 ? "was" : "were"} already unavailable and could not be included.`
    : "";
  return `Backup saved and verified: ${count(summary.recordings, "recording")}, ${formatBytes(summary.bytes)}.${missing}`;
}

/** Settings → Data and backups (§6, §13): destination, create, history and restore check. */
export function BackupSettings() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: statusKey, queryFn: () => ipc.getBackupStatus() });
  const native = ipc.recordingMode === "native";
  const choose = useMutation({
    mutationFn: () => ipc.chooseBackupDestination(),
    onSuccess: (next) => qc.setQueryData(statusKey, next),
  });
  const create = useMutation({
    mutationFn: () => ipc.createBackup(),
    onSettled: () => qc.invalidateQueries({ queryKey: statusKey }),
  });
  const check = useMutation({ mutationFn: () => ipc.previewRestore() });
  const dismiss = async (preview: RestorePreview) => {
    check.reset();
    await ipc.discardRestorePreview(preview.stagingId).catch(() => {});
  };

  const data = status.data;
  const lastGood = data?.backups.find((b) => b.status === "verified");
  const recentFailure = data?.backups[0]?.status === "failed" ? data.backups[0] : null;
  const busy = choose.isPending || create.isPending || check.isPending;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
        <dt className="text-muted-foreground">Backup folder</dt>
        <dd className="min-w-0 break-words">
          {data?.destination ?? "Not chosen"}
          {data?.destination && !data.destinationAvailable && (
            <p role="alert" className="text-meta text-destructive">
              This folder is unavailable. Reconnect the drive or choose another folder. Earlier backups there are kept.
            </p>
          )}
        </dd>
        <dt className="text-muted-foreground">Last successful backup</dt>
        <dd>{lastGood ? `${when(lastGood.createdAt)} · ${lastGood.fileName}` : "Never"}</dd>
      </dl>
      {recentFailure && (
        <p className="text-meta text-muted-foreground">
          The most recent attempt on {when(recentFailure.createdAt)} did not complete; no partial file was kept.
        </p>
      )}
      <p className="text-meta text-muted-foreground">
        A backup includes your sessions, notes, Trash and original recordings. API keys, model files and regenerable caches are not
        included.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!native || busy} onClick={() => choose.mutate()}>
          <FolderOpen aria-hidden /> {data?.destination ? "Change folder…" : "Choose folder…"}
        </Button>
        <Button disabled={!native || busy || !data?.destinationAvailable} onClick={() => create.mutate()}>
          {create.isPending ? "Creating and verifying…" : "Create backup"}
        </Button>
        <Button variant="outline" disabled={!native || busy} onClick={() => { check.reset(); check.mutate(); }}>
          <ShieldCheck aria-hidden /> {check.isPending ? "Checking backup…" : "Check a backup…"}
        </Button>
      </div>
      {!native && <p className="text-meta text-muted-foreground">Backups are available in the desktop app.</p>}

      <div aria-live="polite">
        {create.data && <p role="status" className="text-meta">{savedMessage(create.data)}</p>}
        {(create.error ?? choose.error ?? check.error) && (
          <p role="alert" className="text-meta text-destructive">{(create.error ?? choose.error ?? check.error)!.message}</p>
        )}
        {check.data && (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="font-medium">This backup passed every check</p>
            <p className="text-meta text-muted-foreground">
              Made {when(check.data.createdAtMs)} by ClearPractice {check.data.appVersion}: {count(check.data.sessions, "session")}
              {check.data.trashedSessions > 0 && ` (plus ${check.data.trashedSessions} in Trash)`}, {count(check.data.recordings, "recording")},{" "}
              {formatBytes(check.data.audioBytes)} of audio.
              {check.data.unavailableRecordings > 0 && ` ${count(check.data.unavailableRecordings, "recording")} ${check.data.unavailableRecordings === 1 ? "was" : "were"} unavailable when it was made.`}
            </p>
            <p className="text-meta text-muted-foreground">
              Your current data has not been changed. Restoring from a checked backup comes in the next update.
            </p>
            <Button variant="outline" onClick={() => void dismiss(check.data!)}>Done</Button>
          </div>
        )}
      </div>
    </div>
  );
}
