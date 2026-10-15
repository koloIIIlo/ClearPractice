import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useIpc } from "@/lib/ipc";
import type { AudioProvider, TranscriptionPreference } from "@/lib/ipc/schemas";
import { API_LABELS } from "@/features/review/ApiTranscribe";

/**
 * Default transcription for new takes (§10: Local / API). Each take can still
 * switch. Choosing Cloud sends nothing: every take is previewed and sent only
 * when you press Send, within the shared monthly limit.
 */
export function TranscriptionMode() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const native = ipc.recordingMode === "native";
  const preference = useQuery({ queryKey: ["transcription-preference"], queryFn: () => ipc.getTranscriptionPreference() });
  const keys = useQuery({ queryKey: ["transcription-api-keys"], queryFn: () => ipc.getTranscriptionApiKeys(), enabled: native, retry: false });
  const save = useMutation({
    mutationFn: (next: TranscriptionPreference) => ipc.setTranscriptionPreference(next),
    onSuccess: (saved) => qc.setQueryData(["transcription-preference"], saved),
  });
  const current = preference.data ?? { mode: "local" as const, provider: "deepgram" as const };
  const hasKey = (p: AudioProvider) => !!keys.data?.find((k) => k.provider === p)?.present;

  return (
    <div className="space-y-4">
      <RadioGroup
        value={current.mode}
        onValueChange={(mode) => save.mutate({ ...current, mode: mode as TranscriptionPreference["mode"] })}
        disabled={!native || save.isPending}
        className="gap-3"
        aria-label="Default transcription"
      >
        <Label htmlFor="tmode-local" className="flex items-start gap-3 font-normal">
          <RadioGroupItem id="tmode-local" value="local" className="mt-1" />
          <span>
            <span className="block font-medium">On this computer (Whisper)</span>
            <span className="block text-meta text-muted-foreground">Free and private: audio never leaves this computer.</span>
          </span>
        </Label>
        <Label htmlFor="tmode-api" className="flex items-start gap-3 font-normal">
          <RadioGroupItem id="tmode-api" value="api" className="mt-1" />
          <span>
            <span className="block font-medium">Cloud API</span>
            <span className="block text-meta text-muted-foreground">
              For transcribing a take by hand: each take is previewed (audio, recipient, price) and sent only when you press Send. Counts against the monthly limit. New takes can still be transcribed automatically on this computer (below).
            </span>
          </span>
        </Label>
        <Label htmlFor="tmode-off" className="flex items-start gap-3 font-normal">
          <RadioGroupItem id="tmode-off" value="off" className="mt-1" />
          <span>
            <span className="block font-medium">Off</span>
            <span className="block text-meta text-muted-foreground">No transcription is offered. Playback, notes and existing transcripts still work.</span>
          </span>
        </Label>
      </RadioGroup>
      {current.mode === "api" && (
        <div className="space-y-2 pl-7">
          <p className="text-meta font-medium">Provider</p>
          <RadioGroup
            value={current.provider}
            onValueChange={(provider) => save.mutate({ ...current, provider: provider as AudioProvider })}
            disabled={!native || save.isPending}
            className="gap-2"
            aria-label="Cloud provider"
          >
            {(["deepgram", "assemblyai"] as const).map((p) => (
              <Label key={p} htmlFor={`tprov-${p}`} className="flex items-center gap-2 font-normal">
                <RadioGroupItem id={`tprov-${p}`} value={p} /> {API_LABELS[p]}
                <span className="text-meta text-muted-foreground">· key {hasKey(p) ? "stored" : "not stored yet (add it below)"}</span>
              </Label>
            ))}
          </RadioGroup>
        </div>
      )}
      {!native && <p className="text-meta">Run the desktop app to change this.</p>}
      {save.error && <p role="alert" className="text-meta text-destructive">{save.error.message}</p>}
      <p className="text-meta text-muted-foreground">Each take can still switch between this computer and the cloud.</p>
    </div>
  );
}
