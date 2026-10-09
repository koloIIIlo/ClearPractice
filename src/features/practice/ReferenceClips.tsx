import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileAudio, Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import type { ReferenceClip } from "@/lib/ipc/schemas";
import { AudioPlayer } from "@/components/audio-player";
import { ClipImport } from "./ClipImport";
import { ClipLibrary } from "./ClipLibrary";

const SPEEDS = [0.75, 1, 1.25] as const;

/** Plays one clip with pitch-preserving speed, its transcript and its credit. */
function ClipPlayer({ clip }: { clip: ReferenceClip }) {
  const ipc = useIpc();
  const url = useQuery({ queryKey: ["clip-url", clip.id], queryFn: () => ipc.getClipPlaybackUrl(clip.id), staleTime: Infinity, retry: false });
  return (
    <div className="space-y-2">
      {url.error && <p role="alert" className="text-meta text-destructive">{url.error.message}</p>}
      {url.data && <AudioPlayer src={url.data} label={`clip: ${clip.title}`} speeds={SPEEDS} />}
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

/** Remembers the last clip chosen, per computer (a convenience; may be unavailable). */
const LAST_CLIP = "clearpractice.lastClip";
function readLastClip(): string | null {
  try { return window.localStorage.getItem(LAST_CLIP); } catch { return null; }
}
function writeLastClip(id: string) {
  try { window.localStorage.setItem(LAST_CLIP, id); } catch { /* not stored */ }
}

/**
 * Clip choice for Listen and imitate: the chosen clip with its player, the clip
 * library (folders, search, filters; 4.4h) and import.
 */
export function ReferenceClips({ locked, native, onSelect }: { locked: boolean; native: boolean; onSelect?: (clip: ReferenceClip | null) => void }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const clips = useQuery({ queryKey: ["clips"], queryFn: () => ipc.listClips(), enabled: native, retry: false });
  const [selected, setSelected] = useState<string | null>(readLastClip);
  const [importing, setImporting] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const list = clips.data ?? [];
  const current = list.find((c) => c.id === selected) ?? list[0] ?? null;
  useEffect(() => onSelect?.(current), [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (id: string) => {
    setSelected(id);
    writeLastClip(id);
  };

  if (!native) return <p className="text-meta text-muted-foreground">Clips play and import in the desktop app.</p>;
  return (
    <div className="space-y-3">
      {clips.error && <p role="alert" className="text-meta text-destructive">{clips.error.message}</p>}
      {list.length === 0 && !importing && (
        <p className="text-meta text-muted-foreground">No clips yet. Import a short clip from a file you have the right to use.</p>
      )}
      {current && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-48 flex-1">
              <p className="text-meta text-muted-foreground">Clip</p>
              <p className="font-medium">{current.title} <span className="text-meta font-normal text-muted-foreground">· {formatClock(current.durationMs)}{current.origin === "user" ? " · yours" : ""}</span></p>
            </div>
            <Button variant="outline" disabled={locked} onClick={() => setBrowsing(true)}>
              <Library aria-hidden /> Browse the library ({list.length})
            </Button>
          </div>
          <ClipPlayer key={current.id} clip={current} />
        </>
      )}
      <ClipLibrary
        open={browsing}
        onOpenChange={setBrowsing}
        chosenId={current?.id ?? null}
        onChoose={(clip) => { choose(clip.id); setBrowsing(false); }}
        onImport={() => { setBrowsing(false); setImporting(true); }}
      />
      {importing ? (
        <ClipImport
          onCancel={() => setImporting(false)}
          onSaved={async (saved) => {
            setImporting(false);
            await Promise.all([qc.invalidateQueries({ queryKey: ["clips"] }), qc.invalidateQueries({ queryKey: ["clip-folders"] }), qc.invalidateQueries({ queryKey: ["clip-sources"] })]);
            if (saved[0]) choose(saved[0].id);
          }}
        />
      ) : (
        <Button variant="outline" disabled={locked} onClick={() => setImporting(true)}>
          <FileAudio aria-hidden /> Import clips…
        </Button>
      )}
    </div>
  );
}
