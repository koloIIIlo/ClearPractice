import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useIpc } from "@/lib/ipc";
import type { WhisperChoice, WhisperDownloadProgress } from "@/lib/ipc/schemas";

const STAGE_TEXT: Record<WhisperDownloadProgress["stage"], string> = {
  runtime: "Downloading the Whisper program",
  "gpu-libraries": "Downloading NVIDIA's graphics libraries",
  model: "Downloading the speech model",
  installing: "Checking and installing",
};

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}

function OptionCard({ id, value, title, hint, disabled }: { id: string; value: string; title: string; hint: string; disabled?: boolean }) {
  return (
    <Label
      htmlFor={id}
      className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
    >
      <RadioGroupItem id={id} value={value} disabled={disabled} className="mt-0.5" />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-meta text-muted-foreground">{hint}</span>
      </span>
    </Label>
  );
}

/**
 * One-click local Whisper (user request 2026-10-10): pick graphics card or
 * processor and a model, see the download size, and follow the progress. The
 * official whisper.cpp release and model are checked against pinned checksums
 * before anything is installed; nothing downloads without this click.
 */
export function WhisperDownload({ configured }: { configured: boolean }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const native = ipc.recordingMode === "native";
  const options = useQuery({ queryKey: ["whisper-download-options"], queryFn: () => ipc.getWhisperDownloadOptions() });
  const [choice, setChoice] = useState<WhisperChoice | null>(null);
  const [progress, setProgress] = useState<WhisperDownloadProgress | null>(null);
  const selected: WhisperChoice = choice ?? { backend: options.data?.nvidiaGpu ? "cuda" : "cpu", model: "large-v3-turbo-q5_0" };
  const size = options.data?.sizes.find((s) => s.backend === selected.backend && s.model === selected.model)?.downloadBytes;

  useEffect(() => {
    let disposed = false;
    let remove: (() => void) | undefined;
    void ipc
      .onWhisperDownloadProgress((p) => !disposed && setProgress(p))
      .then((unlisten) => (disposed ? unlisten() : (remove = unlisten)))
      .catch(() => {});
    return () => {
      disposed = true;
      remove?.();
    };
  }, [ipc]);

  const download = useMutation({
    mutationFn: () => ipc.downloadWhisper(selected),
    onMutate: () => setProgress(null),
    onSuccess: (setup) => {
      qc.setQueryData(["transcription-setup"], setup);
      void qc.invalidateQueries({ queryKey: ["model-packs"] });
      void qc.invalidateQueries({ queryKey: ["whisper-download-options"] });
      void qc.invalidateQueries({ queryKey: ["service-status"] });
      toast.success("Local Whisper is ready. New takes can now be transcribed on this computer.");
    },
    onSettled: () => setProgress(null),
  });
  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : null;

  return (
    <section data-tour="whisper" aria-labelledby="whisper-download-heading" className="space-y-4 rounded-lg border px-4 py-4">
      <div>
        <h3 id="whisper-download-heading" className="font-medium">{configured ? "Download a different setup" : "Get local Whisper"}</h3>
        <p className="text-meta text-muted-foreground">
          Transcribes on this computer: free, private, and offline once downloaded. The official whisper.cpp release and model are checked
          against known checksums before anything is installed.
        </p>
      </div>
      <fieldset disabled={download.isPending} className="space-y-2">
        <legend className="mb-1 text-meta font-medium">Runs on</legend>
        <RadioGroup value={selected.backend} onValueChange={(v) => setChoice({ ...selected, backend: v as WhisperChoice["backend"] })} className="grid gap-2 sm:grid-cols-2">
          <OptionCard
            id="whisper-cuda"
            value="cuda"
            title="Graphics card (NVIDIA)"
            hint={options.data?.nvidiaGpu ? "Several times faster. Recommended for this computer." : "No NVIDIA graphics driver was found on this computer."}
            disabled={options.data ? !options.data.nvidiaGpu : false}
          />
          <OptionCard id="whisper-cpu" value="cpu" title="Processor" hint="Works on any computer; slower on long takes." />
        </RadioGroup>
      </fieldset>
      <fieldset disabled={download.isPending} className="space-y-2">
        <legend className="mb-1 text-meta font-medium">Speech model</legend>
        <RadioGroup value={selected.model} onValueChange={(v) => setChoice({ ...selected, model: v as WhisperChoice["model"] })} className="grid gap-2 sm:grid-cols-2">
          <OptionCard id="whisper-turbo" value="large-v3-turbo-q5_0" title="Large v3 Turbo" hint="Most accurate, keeps hesitation words. 574 MB." />
          <OptionCard id="whisper-base" value="base" title="Base" hint="Smaller and faster, less accurate. 148 MB." />
        </RadioGroup>
      </fieldset>

      {download.isPending ? (
        <div className="space-y-2" role="status" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2 text-meta">
            <span className="font-medium">{progress ? STAGE_TEXT[progress.stage] : "Starting the download"}…</span>
            {progress && progress.total > 0 && (
              <span className="text-muted-foreground tabular-nums">
                {formatBytes(progress.received)} of {formatBytes(progress.total)}
              </span>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden>
            <div
              className={percent === null ? "h-full w-1/3 animate-pulse rounded-full bg-primary/60" : "h-full rounded-full bg-primary transition-[width] duration-300"}
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => void ipc.cancelWhisperDownload()}>
            <X aria-hidden /> Stop
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant={configured ? "outline" : "default"} disabled={!native || size === undefined} onClick={() => download.mutate()}>
            <Download aria-hidden /> {size === 0 ? "Set up" : "Download and set up"}
          </Button>
          <span className="text-meta text-muted-foreground tabular-nums">
            {!native
              ? "Downloads in the desktop app."
              : size === undefined
                ? "Checking what is already installed…"
                : size === 0
                  ? "Everything needed is already downloaded."
                  : `About ${formatBytes(size)} to download, stored in the app's data folder.`}
          </span>
        </div>
      )}
      {download.error && <p role="alert" className="text-meta text-destructive">{download.error.message}</p>}
    </section>
  );
}
