import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
import { Panel } from "@/components/page";
import { useIpc } from "@/lib/ipc";
import { formatClock, UI_LOCALE } from "@/lib/format";
import type { SavedRecording } from "@/lib/ipc/schemas";
import { WaveformPlayer } from "@/features/review/WaveformPlayer";
import type { PlayerLink } from "@/features/review/player-link";

export function SavedAudio({ recording, link }: { recording: SavedRecording; link?: PlayerLink }) {
  const ipc = useIpc();
  const [opened, setOpened] = useState(false);
  const enabled = opened && ipc.recordingMode === "native";
  const playback = useQuery({
    queryKey: ["recording-playback", recording.assetId],
    queryFn: () => ipc.getRecordingPlaybackUrl(recording.assetId),
    enabled,
    retry: false,
  });
  const waveform = useQuery({
    queryKey: ["recording-waveform", recording.assetId, recording.sha256],
    queryFn: () => ipc.getRecordingWaveform(recording.assetId),
    enabled,
    retry: false,
    staleTime: Infinity,
  });
  if (ipc.recordingMode !== "native") return null;
  const error = playback.error ?? waveform.error;
  return (
    <div className="space-y-2">
      {!opened && <Button variant="outline" onClick={() => setOpened(true)}>Listen to recording</Button>}
      {opened && !error && (playback.isPending || waveform.isPending) && (
        <p role="status" className="text-meta text-muted-foreground">Opening recording…</p>
      )}
      {error && <p role="alert" className="text-meta text-destructive">{error.message}</p>}
      {playback.data && waveform.data && (
        <WaveformPlayer url={playback.data} peaks={waveform.data} label={recording.title || "recording"} link={link} />
      )}
    </div>
  );
}

/** Native capture journal and explicit recovery, alongside durable session history. */
export function RecordingLibrary() {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const isNative = ipc.recordingMode === "native";
  const saved = useQuery({ queryKey: ["recordings"], queryFn: () => ipc.listRecordings(), enabled: isNative });
  const interrupted = useQuery({ queryKey: ["recording-recovery"], queryFn: () => ipc.listRecoverableRecordings(), enabled: isNative });
  const discard = useMutation({
    mutationFn: (id: string) => ipc.discardRecoverableRecording(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["recording-recovery"] }),
  });
  const recovery = useMutation({
    mutationFn: (id: string) => ipc.recoverRecording(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["recordings"] });
      await queryClient.invalidateQueries({ queryKey: ["recording-recovery"] });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
  useEffect(() => {
    if (!isNative) return;
    let disposed = false;
    let remove: (() => void) | undefined;
    void ipc.onRecordingEvent((status) => {
      if (["saved", "interrupted"].includes(status.phase)) {
        void queryClient.invalidateQueries({ queryKey: ["recordings"] });
        void queryClient.invalidateQueries({ queryKey: ["recording-recovery"] });
        void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      }
    }).then((unsubscribe) => { if (disposed) unsubscribe(); else remove = unsubscribe; }).catch(() => {});
    return () => { disposed = true; remove?.(); };
  }, [ipc, queryClient, isNative]);

  if (!isNative) return null;
  return (
    <Panel className="space-y-4">
      <h2 className="font-semibold">Your recordings on this computer</h2>
      {saved.isPending && <p role="status" className="text-muted-foreground">Looking for saved recordings…</p>}
      {(saved.error || interrupted.error) && <p role="alert" className="text-destructive">{(saved.error || interrupted.error)?.message}</p>}
      {!!interrupted.data?.length && (
        <section aria-labelledby="recovery-heading" className="space-y-3 rounded-lg border border-dashed p-3">
          <h3 id="recovery-heading" className="font-medium">Interrupted takes</h3>
          <p className="text-meta text-muted-foreground">Recover the completed audio chunks from a take that did not finish saving.</p>
          {interrupted.data.map((take) => (
            <div key={take.attemptId} className="space-y-1">
              <p className="text-meta">{take.title || "Untitled take"} · {take.durationMs === null ? "Duration unavailable" : formatClock(take.durationMs)}</p>
              {take.unavailableReason && <p className="text-meta text-muted-foreground">{take.unavailableReason}</p>}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={recovery.isPending || discard.isPending || !!take.unavailableReason} onClick={() => recovery.mutate(take.attemptId)}>
                  {recovery.isPending && recovery.variables === take.attemptId ? "Recovering…" : "Recover take"}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" disabled={recovery.isPending || discard.isPending}>Discard…</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Discard this interrupted take?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {take.durationMs === null ? "Its" : `About ${formatClock(take.durationMs)} of`} unrecovered audio will be deleted from this
                        computer. This cannot be undone. Saved takes and sessions are not affected.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep it</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={() => discard.mutate(take.attemptId)}>Discard permanently</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
          {(recovery.error ?? discard.error) && <p role="alert" className="text-destructive">{(recovery.error ?? discard.error)!.message}</p>}
        </section>
      )}
      {saved.data?.length === 0 && <p className="text-muted-foreground">Your first saved take will appear here. It remains available after closing the app.</p>}
      <ul className="space-y-3">
        {saved.data?.map((take) => (
          <li key={take.assetId} className="space-y-2 rounded-lg border p-3">
            <p className="font-medium">{take.title || "Untitled take"}</p>
            <p className="text-meta text-muted-foreground">
              {new Date(take.createdAtMs).toLocaleString(UI_LOCALE)} · {formatClock(take.durationMs)} · {take.recovered ? "Recovered" : "Saved"}
            </p>
            <SavedAudio recording={take} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
