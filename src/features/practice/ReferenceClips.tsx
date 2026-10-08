import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileAudio, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatClock } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import type { ReferenceClip } from "@/lib/ipc/schemas";
import { ClipImport } from "./ClipImport";

const SPEEDS = [0.75, 1, 1.25] as const;

/** Plays one clip with pitch-preserving speed, its transcript and its credit. */
function ClipPlayer({ clip }: { clip: ReferenceClip }) {
  const ipc = useIpc();
  const audio = useRef<HTMLAudioElement>(null);
  const [rate, setRate] = useState(1);
  const url = useQuery({ queryKey: ["clip-url", clip.id], queryFn: () => ipc.getClipPlaybackUrl(clip.id), staleTime: Infinity, retry: false });
  useEffect(() => {
    if (audio.current) {
      audio.current.preservesPitch = true;
      audio.current.playbackRate = rate;
    }
  }, [rate, url.data]);
  return (
    <div className="space-y-2">
      {url.error && <p role="alert" className="text-meta text-destructive">{url.error.message}</p>}
      {url.data && (
        <div className="flex flex-wrap items-center gap-3">
          <audio ref={audio} controls src={url.data} className="h-10 w-full max-w-md" aria-label={`Play clip: ${clip.title}`} />
          <span id={`speed-${clip.id}`} className="text-meta text-muted-foreground">Speed</span>
          <Select value={String(rate)} onValueChange={(v) => setRate(Number(v))}>
            <SelectTrigger size="sm" className="w-24" aria-labelledby={`speed-${clip.id}`}><SelectValue /></SelectTrigger>
            <SelectContent>{SPEEDS.map((s) => <SelectItem key={s} value={String(s)}>{s}×</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
      {clip.transcript && (
        <details className="text-meta">
          <summary className="cursor-pointer">Transcript</summary>
          <p className="mt-1 whitespace-pre-wrap">{clip.transcript}</p>
        </details>
      )}
      {(clip.description || clip.feature) && (
        <p className="text-meta">
          {clip.feature && <span className="font-medium">Listen for: {{ emphasis: "emphasis", rhythm: "phrase rhythm", endings: "clear endings" }[clip.feature]}. </span>}
          {clip.description}
        </p>
      )}
      <p className="text-meta text-muted-foreground">Source: {clip.source || "not given"}</p>
    </div>
  );
}

/** Clip picker for Listen and imitate: bundled and imported clips, play, import, delete. */
export function ReferenceClips({ locked, native, onSelect }: { locked: boolean; native: boolean; onSelect?: (clip: ReferenceClip | null) => void }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const clips = useQuery({ queryKey: ["clips"], queryFn: () => ipc.listClips(), enabled: native, retry: false });
  const [selected, setSelected] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => ipc.deleteClip(id),
    onSuccess: async () => {
      setSelected(null);
      await qc.invalidateQueries({ queryKey: ["clips"] });
    },
  });
  const list = clips.data ?? [];
  const current = list.find((c) => c.id === selected) ?? list[0] ?? null;
  useEffect(() => onSelect?.(current), [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!native) return <p className="text-meta text-muted-foreground">Clips play and import in the desktop app.</p>;
  return (
    <div className="space-y-3">
      {list.length === 0 && !importing && (
        <p className="text-meta text-muted-foreground">No clips yet. Import a short clip from a file you have the right to use.</p>
      )}
      {list.length > 0 && current && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="clip-choice">Clip</Label>
              <Select value={current.id} onValueChange={setSelected} disabled={locked}>
                <SelectTrigger id="clip-choice" className="h-10 w-80"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {list.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.title} · {formatClock(c.durationMs)}{c.origin === "user" ? " · yours" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {current.origin === "user" && (
              <Button variant="ghost" size="sm" disabled={locked || remove.isPending} onClick={() => remove.mutate(current.id)} aria-label={`Delete clip ${current.title}`}>
                <Trash2 aria-hidden /> Delete clip
              </Button>
            )}
          </div>
          <ClipPlayer clip={current} />
        </>
      )}
      {remove.error && <p role="alert" className="text-meta text-destructive">{remove.error.message}</p>}
      {importing ? (
        <ClipImport
          onCancel={() => setImporting(false)}
          onSaved={async (saved) => {
            setImporting(false);
            await qc.invalidateQueries({ queryKey: ["clips"] });
            setSelected(saved[0]?.id ?? null);
          }}
        />
      ) : (
        <Button variant="outline" disabled={locked} onClick={() => setImporting(true)}>
          <FileAudio aria-hidden /> Import a clip…
        </Button>
      )}
    </div>
  );
}
