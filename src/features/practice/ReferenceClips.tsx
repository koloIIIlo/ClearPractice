import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileAudio, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatClock } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import type { ClipStaged, ReferenceClip } from "@/lib/ipc/schemas";
import { formatClockTenths, parseClock } from "@/features/review/waveform";

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
      <p className="text-meta text-muted-foreground">Source: {clip.source || "not given"}</p>
    </div>
  );
}

/**
 * Import a clip from a local file (4.4a): the file is decoded on this computer,
 * previewed whole, and only the chosen 3–30 s section is kept.
 */
function ImportClip({ onSaved, onCancel }: { onSaved: (clip: ReferenceClip) => void; onCancel: () => void }) {
  const ipc = useIpc();
  const preview = useRef<HTMLAudioElement>(null);
  const [staged, setStaged] = useState<ClipStaged | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [start, setStart] = useState("0:00.0");
  const [end, setEnd] = useState("0:15.0");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stagedRef = useRef<ClipStaged | null>(null);
  useEffect(() => () => { if (stagedRef.current) void ipc.discardClipStaging(stagedRef.current.stagingId); }, [ipc]);

  const choose = async () => {
    setBusy(true); setError(null);
    try {
      const next = await ipc.chooseClipFile();
      if (!next) return;
      if (stagedRef.current) void ipc.discardClipStaging(stagedRef.current.stagingId);
      stagedRef.current = next;
      setStaged(next);
      setTitle((t) => t || next.fileName.replace(/\.[^.]+$/, ""));
      setEnd(formatClockTenths(Math.min(next.durationMs, 15_000)));
      setUrl(await ipc.getClipStagingUrl(next.stagingId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The file could not be opened.");
    } finally {
      setBusy(false);
    }
  };
  const here = (set: (v: string) => void) => preview.current && set(formatClockTenths(preview.current.currentTime * 1000));
  const save = async () => {
    if (!staged) return;
    const startMs = parseClock(start);
    const endMs = parseClock(end);
    if (startMs === null || endMs === null) return setError("Enter times as m:ss, for example 0:12.5.");
    if (endMs - startMs < 3_000 || endMs - startMs > 30_000) return setError("Keep a section between 3 and 30 seconds long.");
    if (!title.trim()) return setError("Give the clip a title.");
    setBusy(true); setError(null);
    try {
      const clip = await ipc.saveClip({ stagingId: staged.stagingId, startMs, endMs, title: title.trim(), source: source.trim(), transcript: transcript.trim() || null });
      stagedRef.current = null;
      onSaved(clip);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The clip could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-3" role="group" aria-label="Import a clip">
      <p className="text-meta text-muted-foreground">
        Use a recording you have the right to keep for your own practice, such as a talk you downloaded from an official source. It stays on this
        computer, is never uploaded and is not shared with anyone.
      </p>
      <Button variant="outline" disabled={busy} onClick={() => void choose()}>
        <FileAudio aria-hidden /> {staged ? "Choose another file…" : "Choose an audio file…"}
      </Button>
      {staged && (
        <>
          <p className="text-meta">{staged.fileName} · {formatClock(staged.durationMs)}</p>
          {url && <audio ref={preview} controls src={url} className="h-10 w-full" aria-label="Preview the whole file" />}
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="clip-start">Keep from</Label>
              <Input id="clip-start" className="w-24 tabular-nums" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => here(setStart)}>Start here</Button>
            <div className="space-y-1">
              <Label htmlFor="clip-end">to</Label>
              <Input id="clip-end" className="w-24 tabular-nums" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => here(setEnd)}>End here</Button>
            <span className="text-meta text-muted-foreground">3–30 seconds</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="clip-title">Title</Label>
              <Input id="clip-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="clip-source">Source and credit</Label>
              <Input id="clip-source" maxLength={500} placeholder="Speaker, talk, year, where you got it" value={source} onChange={(e) => setSource(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="clip-transcript">Transcript (optional)</Label>
            <Textarea id="clip-transcript" rows={2} maxLength={4000} value={transcript} onChange={(e) => setTranscript(e.target.value)} />
          </div>
        </>
      )}
      {error && <p role="alert" className="text-meta text-destructive">{error}</p>}
      <div className="flex gap-2">
        {staged && <Button disabled={busy} onClick={() => void save()}>Save clip</Button>}
        <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
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
        <ImportClip
          onCancel={() => setImporting(false)}
          onSaved={async (clip) => {
            setImporting(false);
            await qc.invalidateQueries({ queryKey: ["clips"] });
            setSelected(clip.id);
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
