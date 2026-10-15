import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIpc } from "@/lib/ipc";
import { WhisperDownload } from "./WhisperDownload";

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
  const packs = useQuery({ queryKey: ["model-packs"], queryFn: () => ipc.listModelPacks(), enabled: native });
  const importPack = useMutation({
    mutationFn: () => ipc.importModelPack(),
    onSuccess: (next) => qc.setQueryData(["model-packs"], next),
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
      <WhisperDownload configured={!!data?.configured} />
      <details className="space-y-3">
        <summary className="text-meta font-medium">Advanced: use your own Whisper setup file or model file</summary>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" disabled={!native || choose.isPending} onClick={() => choose.mutate()}>
          <FileCheck2 aria-hidden /> {choose.isPending ? "Verifying runtime and model…" : data?.configured ? "Change setup file…" : "Choose setup file…"}
        </Button>
      </div>
      <p className="text-meta text-muted-foreground">
        Choose the setup file written by <code>bench/Prepare-Whisper.ps1</code> (for example <code>runtime.local/config-selected.json</code>). Verifying
        a large model takes a few seconds. A failed check keeps the previous setup.
      </p>
      {choose.error && <p role="alert" className="text-meta text-destructive">{choose.error.message}</p>}
      {native && (
        <div className="space-y-2">
          <h3 className="font-medium">Model packs</h3>
          <ul className="divide-y rounded-lg border">
            {packs.data?.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <div>
                  <p className="font-medium">{p.id}</p>
                  <p className="text-meta text-muted-foreground">
                    {(p.bytes / (1024 * 1024)).toFixed(0)} MiB · {p.language} · {p.license}
                  </p>
                </div>
                <span className="text-meta">{p.installed ? "Installed in the app" : "Not installed"}</span>
              </li>
            ))}
          </ul>
          <Button variant="outline" disabled={importPack.isPending} onClick={() => importPack.mutate()}>
            {importPack.isPending ? "Verifying and installing…" : "Import model file…"}
          </Button>
          <p className="text-meta text-muted-foreground">
            Only the known packs above are accepted; size and SHA-256 must match exactly. Once installed, transcription uses the app's own copy.
          </p>
          {importPack.error && <p role="alert" className="text-meta text-destructive">{importPack.error.message}</p>}
        </div>
      )}
      </details>
    </div>
  );
}
