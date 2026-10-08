import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, ShieldCheck } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { UI_LOCALE } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { BACKUP_KEEP_CHOICES, BackupKeep, type BackupSummary, type RestorePreview } from "@/lib/ipc/schemas";
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

/** Settings → Data and backups (§6, §13): destination, create, history, check and restore. */
export function BackupSettings() {
  const ipc = useIpc();
  const qc = useQueryClient();
  // Automatic backups run in the background, so keep this view current while it is open.
  const status = useQuery({ queryKey: statusKey, queryFn: () => ipc.getBackupStatus(), refetchInterval: 60_000 });
  const native = ipc.recordingMode === "native";
  const choose = useMutation({
    mutationFn: () => ipc.chooseBackupDestination(),
    onSuccess: (next) => qc.setQueryData(statusKey, next),
  });
  const create = useMutation({
    mutationFn: () => ipc.createBackup(),
    onSettled: () => qc.invalidateQueries({ queryKey: statusKey }),
  });
  const auto = useMutation({
    mutationFn: ({ enabled, keep }: { enabled: boolean; keep: BackupKeep }) => ipc.setAutoBackup(enabled, keep),
    onSuccess: (next) => qc.setQueryData(statusKey, next),
  });
  const check = useMutation({ mutationFn: () => ipc.previewRestore() });
  const restore = useMutation({
    mutationFn: (preview: RestorePreview) => ipc.restoreBackup(preview.stagingId),
    // Every cached screen described the previous data.
    onSuccess: async () => {
      check.reset();
      await qc.invalidateQueries();
    },
  });
  const dismiss = async (preview: RestorePreview) => {
    check.reset();
    await ipc.discardRestorePreview(preview.stagingId).catch(() => {});
  };

  const data = status.data;
  const lastGood = data?.backups.find((b) => b.status === "verified");
  const recentFailure = data?.backups[0]?.status === "failed" ? data.backups[0] : null;
  const busy = choose.isPending || create.isPending || check.isPending || restore.isPending || auto.isPending;

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
        {data?.nextDueAtMs != null && (
          <>
            <dt className="text-muted-foreground">Next automatic backup</dt>
            <dd>{data.nextDueAtMs <= Date.now() ? "Due now: runs within a few minutes while ClearPractice is open" : when(data.nextDueAtMs)}</dd>
          </>
        )}
      </dl>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <Switch
            id="auto-backup"
            checked={data?.autoEnabled ?? true}
            disabled={!native || !data || busy}
            onCheckedChange={(enabled) => data && auto.mutate({ enabled, keep: data.keep })}
          />
          <Label htmlFor="auto-backup" className="font-normal">Weekly automatic backup while the app is open</Label>
        </div>
        <div className="flex items-center gap-2">
          <span id="backup-keep-label" className="text-meta text-muted-foreground">Keep</span>
          <Select
            value={String(data?.keep ?? 4)}
            disabled={!native || !data || busy}
            onValueChange={(v) => data && auto.mutate({ enabled: data.autoEnabled, keep: BackupKeep.parse(Number(v)) })}
          >
            <SelectTrigger className="h-10 w-36" aria-labelledby="backup-keep-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BACKUP_KEEP_CHOICES.map((n) => <SelectItem key={n} value={String(n)}>{n} backups</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-meta text-muted-foreground">
        Older automatic and manual backups beyond this number are deleted only after a new backup has been verified. Other files in
        the folder are never touched.
      </p>
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
        <Button variant="outline" disabled={!native || busy} onClick={() => { check.reset(); restore.reset(); check.mutate(); }}>
          <ShieldCheck aria-hidden /> {check.isPending ? "Checking backup…" : "Check a backup…"}
        </Button>
      </div>
      {!native && <p className="text-meta text-muted-foreground">Backups are available in the desktop app.</p>}

      <div aria-live="polite">
        {create.data && <p role="status" className="text-meta">{savedMessage(create.data)}</p>}
        {restore.data && (
          <p role="status" className="text-meta">
            Backup restored. The data you had before is kept in the app data folder under {restore.data.rollbackFolder}.
          </p>
        )}
        {(create.error ?? choose.error ?? check.error ?? restore.error ?? auto.error) && (
          <p role="alert" className="text-meta text-destructive">{(create.error ?? choose.error ?? check.error ?? restore.error ?? auto.error)!.message}</p>
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
            <p className="text-meta text-muted-foreground">Your current data has not been changed.</p>
            <div className="flex flex-wrap gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={busy}>Replace current data…</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Replace your current data with this backup?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Your sessions, notes, Trash and recordings will be replaced by the backup from {when(check.data.createdAtMs)}.
                      Anything recorded or edited after that date is not in the backup. Your current data is not deleted: it is
                      moved to a rollback folder inside the app data folder, and it is put back automatically if the restore fails.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep current data</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => restore.mutate(check.data!)}>
                      Replace current data
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button variant="outline" disabled={restore.isPending} onClick={() => void dismiss(check.data!)}>Done</Button>
            </div>
            {restore.isPending && <p role="status" className="text-meta">Restoring and verifying…</p>}
          </div>
        )}
      </div>
    </div>
  );
}
