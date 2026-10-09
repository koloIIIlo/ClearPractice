import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EvidenceLabel } from "@/components/evidence";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useIpc } from "@/lib/ipc";
import type { IntonationContour, ReferenceClip } from "@/lib/ipc/schemas";

/** Semitones relative to the speaker's own median, so two voices compare fairly. */
export function relativeSemitones(c: IntonationContour): (number | null)[] {
  const voiced = c.f0Hz.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const median = c.medianF0Hz ?? (voiced.length ? voiced[Math.floor(voiced.length / 2)] : null);
  if (!median) return c.f0Hz.map(() => null);
  return c.f0Hz.map((hz) => (hz === null ? null : 12 * Math.log2(hz / median)));
}

/** First and last voiced frame, or null without voicing. */
export function voicedSpan(semis: (number | null)[]): [number, number] | null {
  const first = semis.findIndex((v) => v !== null);
  if (first < 0) return null;
  let last = semis.length - 1;
  while (last > first && semis[last] === null) last--;
  return [first, last];
}

/**
 * Pitch change over the last quarter-second of voicing, in semitones (rounded to
 * 0.1): the same "ending" the rest of the app describes. Null with too little voicing.
 */
export function endingChange(semis: (number | null)[], hopMs: number): number | null {
  const span = voicedSpan(semis);
  if (!span) return null;
  const frames = Math.max(4, Math.round(250 / hopMs));
  const tail = semis.slice(Math.max(span[0], span[1] - frames + 1), span[1] + 1).filter((v): v is number => v !== null);
  if (tail.length < 4) return null;
  const edge = Math.max(1, Math.floor(tail.length / 4));
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  return Math.round((mean(tail.slice(-edge)) - mean(tail.slice(0, edge))) * 10) / 10;
}

export function describeEnding(st: number | null): string {
  if (st === null) return "not enough voicing to say";
  if (Math.abs(st) < 1) return `stays level (${st >= 0 ? "+" : "−"}${Math.abs(st).toFixed(1)} st)`;
  return `${st > 0 ? "rises" : "falls"} ${Math.abs(st).toFixed(1)} st`;
}

const RANGE = 12; // ±12 semitones around each speaker's median

/** SVG path pieces: a new piece wherever the voice stops, never drawn through gaps. */
export function linePaths(semis: (number | null)[], xAt: (i: number) => number, yAt: (st: number) => number): string[] {
  const paths: string[] = [];
  let current = "";
  semis.forEach((v, i) => {
    if (v === null) {
      if (current) paths.push(current);
      current = "";
      return;
    }
    const point = `${xAt(i).toFixed(1)},${yAt(Math.max(-RANGE, Math.min(RANGE, v))).toFixed(1)}`;
    current = current ? `${current} L${point}` : `M${point}`;
  });
  if (current) paths.push(current);
  return paths;
}

/**
 * Imitation overlay (P.5): the reference clip's pitch line and your latest
 * take's, each relative to its own speaker, aligned where speech starts, with
 * an option to stretch the take to the reference's length. For looking and
 * listening, never a score.
 */
export function ImitationOverlay({ clip, takeAssetId }: { clip: ReferenceClip; takeAssetId: string }) {
  const ipc = useIpc();
  const id = useId();
  const [stretch, setStretch] = useState(false);
  const reference = useQuery({ queryKey: ["clip-prosody", clip.id, clip.sha256], queryFn: () => ipc.getClipProsody(clip.id), staleTime: Infinity, retry: false });
  const take = useQuery({ queryKey: ["take-prosody", takeAssetId], queryFn: () => ipc.getTakeProsody(takeAssetId), staleTime: Infinity, retry: false });
  if (reference.isPending || take.isPending) return <p role="status" className="text-meta text-muted-foreground">Drawing both pitch lines…</p>;
  if (reference.error || take.error) return <p role="alert" className="text-meta text-destructive">{(reference.error ?? take.error)!.message}</p>;
  const ref = reference.data!, mine = take.data!;
  const refSemis = relativeSemitones(ref), mineSemis = relativeSemitones(mine);
  const refSpan = voicedSpan(refSemis), mineSpan = voicedSpan(mineSemis);
  if (!refSpan || !mineSpan) {
    return <p className="text-meta text-muted-foreground">{!refSpan ? "The clip" : "Your take"} has too little voiced speech to draw a pitch line.</p>;
  }
  const refMs = (refSpan[1] - refSpan[0]) * ref.hopMs;
  const mineMs = (mineSpan[1] - mineSpan[0]) * mine.hopMs;
  const scale = stretch && mineMs > 0 ? refMs / mineMs : 1;
  const totalMs = Math.max(refMs, mineMs * scale, 1);
  const W = 640, H = 160, pad = 8;
  const yAt = (st: number) => H / 2 - (st / RANGE) * (H / 2 - pad);
  const xFor = (c: IntonationContour, span: [number, number], k: number) => (i: number) => pad + (((i - span[0]) * c.hopMs * k) / totalMs) * (W - 2 * pad);
  const refPaths = linePaths(refSemis.map((v, i) => (i < refSpan[0] || i > refSpan[1] ? null : v)), xFor(ref, refSpan, 1), yAt);
  const minePaths = linePaths(mineSemis.map((v, i) => (i < mineSpan[0] || i > mineSpan[1] ? null : v)), xFor(mine, mineSpan, scale), yAt);
  const refEnd = describeEnding(endingChange(refSemis, ref.hopMs));
  const mineEnd = describeEnding(endingChange(mineSemis, mine.hopMs));

  return (
    <figure className="space-y-2 rounded-panel border bg-card p-3" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption id={`${id}-title`} className="font-medium">Pitch lines compared</figcaption>
        <div className="flex items-center gap-2">
          <Switch id={`${id}-stretch`} checked={stretch} onCheckedChange={setStretch} />
          <Label htmlFor={`${id}-stretch`} className="text-meta">Stretch my take to the clip's length</Label>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" role="img" aria-label={`Reference ${refEnd} at the end; your take ${mineEnd}.`} preserveAspectRatio="none">
        <line x1={pad} x2={W - pad} y1={H / 2} y2={H / 2} className="stroke-border" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        {refPaths.map((d, i) => <path key={`r${i}`} d={d} fill="none" className="stroke-muted-foreground" strokeWidth={2} strokeDasharray="6 4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
        {minePaths.map((d, i) => <path key={`m${i}`} d={d} fill="none" className="stroke-primary" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div className="flex flex-wrap items-center gap-4 text-meta">
        <span className="flex items-center gap-2"><span aria-hidden className="inline-block h-0 w-6 border-t-2 border-dashed border-muted-foreground" /> Clip: ends {refEnd}</span>
        <span className="flex items-center gap-2"><span aria-hidden className="inline-block h-0 w-6 border-t-2 border-primary" /> Your latest take: ends {mineEnd}</span>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
        <EvidenceLabel source="estimated" /> Each line is relative to that speaker's own typical pitch and starts where speech starts; gaps are pauses or unvoiced sounds. Compare the shape you chose to imitate and listen again. There is no score.
      </p>
    </figure>
  );
}
