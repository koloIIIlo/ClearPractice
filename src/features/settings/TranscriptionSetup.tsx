import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIpc } from "@/lib/ipc";

/** Settings → Transcription → Local Whisper (plan 3.3, 3.12): the verified worker setup. */
export function TranscriptionSetup() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const native = ipc.recordingMode === "native";
  const setup = useQuery({ queryKey: ["transcription-setup"], queryFn: () => ipc.getTranscriptionSetup() });
  const choose = useMutation({
    mutationFn: () => ipc.chooseTranscriptionSetup(),
    onSuccess: (next) => qc.setQueryData(["transcription-setup"], next),
  });
  const data = setup.data;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border px-4 py-3">
        {data?.configured ? (
          <>
            <p className="font-medium">{data.modelId}</p>
            <p className="text-meta text-muted-foreground">
              {data.backend === "cuda" ? "NVIDIA GPU (CUDA)" : "CPU"}
              {data.prompt ? " · filler-keeping prompt" : ""} · runtime and model checksums are verified before every run
            </p>
          </>
        ) : (
          <>
            <p className="font-medium">Not set up</p>
            <p className="text-meta text-muted-foreground">{data?.unavailableReason ?? "Checking…"}</p>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!native || choose.isPending} onClick={() => choose.mutate()}>
          <FileCheck2 aria-hidden /> {choose.isPending ? "Verifying runtime and model…" : data?.configured ? "Change setup file…" : "Choose setup file…"}
        </Button>
      </div>
      <p className="text-meta text-muted-foreground">
        Choose the setup file written by <code>bench/Prepare-Whisper.ps1</code> (for example <code>runtime.local/config-selected.json</code>). Verifying
        a large model takes a few seconds. A failed check keeps the previous setup.
      </p>
      {choose.error && <p role="alert" className="text-meta text-destructive">{choose.error.message}</p>}
    </div>
  );
}
