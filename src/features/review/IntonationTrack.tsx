import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { EvidenceLabel } from "@/components/evidence";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import type { IntonationContour } from "@/lib/ipc/schemas";

const SPAN_SEMITONES = 12; // ±12 around the median fills the height

/** Polyline segments, broken wherever the voice is unvoiced or silent (P.4). */
export function contourPaths(c: IntonationContour, width: number, height: number): string[] {
  if (!c.medianF0Hz || c.f0Hz.length < 2) return [];
  const paths: string[] = [];
  let current: string[] = [];
  c.f0Hz.forEach((f0, i) => {
    if (f0 == null) {
      if (current.length > 1) paths.push(current.join(" "));
      current = [];
      return;
    }
    const semitones = 12 * Math.log2(f0 / c.medianF0Hz!);
    const clamped = Math.max(-SPAN_SEMITONES, Math.min(SPAN_SEMITONES, semitones));
    const x = (i / (c.f0Hz.length - 1)) * width;
    const y = height / 2 - (clamped / SPAN_SEMITONES) * (height / 2);
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length > 1) paths.push(current.join(" "));
  return paths;
}

/** Loudness band along the bottom: −60…0 dBFS mapped to `band` pixels; silence is a gap. */
export function loudnessPaths(c: IntonationContour, width: number, height: number, band: number): string[] {
  const paths: string[] = [];
  let current: string[] = [];
  c.rmsDb.forEach((db, i) => {
    if (db == null || db < -60) {
      if (current.length > 1) paths.push(current.join(" "));
      current = [];
      return;
    }
    const x = (i / Math.max(1, c.rmsDb.length - 1)) * width;
    const y = height - ((Math.min(0, db) + 60) / 60) * band;
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length > 1) paths.push(current.join(" "));
  return paths;
}

/**
 * Pitch movement of one take under its player: rising and falling, measured
 * from the audio. No score, no correct/incorrect colouring, no mood (§11, D-18).
 */
export function IntonationTrack({ attemptId }: { attemptId: string }) {
  const ipc = useIpc();
  const [open, setOpen] = useState(false);
  const contour = useQuery({ queryKey: ["intonation", attemptId], queryFn: () => ipc.getTakeProsody(attemptId), enabled: open, staleTime: Infinity });
  if (!open)
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Activity aria-hidden /> Show intonation
      </Button>
    );
  if (contour.isPending) return <p role="status" className="text-meta text-muted-foreground">Analysing pitch…</p>;
  if (contour.error) return <p role="alert" className="text-meta text-destructive">{contour.error.message}</p>;
  const c = contour.data;
  const paths = contourPaths(c, 1000, 80);
  const durationMs = c.f0Hz.length * c.hopMs;
  return (
    <figure className="space-y-1">
      <svg viewBox="0 0 1000 80" preserveAspectRatio="none" className="h-20 w-full rounded-md bg-secondary/50" aria-hidden>
        <line x1="0" y1="40" x2="1000" y2="40" className="stroke-border" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
        {loudnessPaths(c, 1000, 80, 16).map((points, i) => (
          <polyline key={`l${i}`} points={points} fill="none" className="stroke-border" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ))}
        {paths.map((points, i) => (
          <polyline key={i} points={points} fill="none" className="stroke-muted-foreground" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <figcaption className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
        <EvidenceLabel source="estimated" />
        {c.unavailableReason
          ? c.unavailableReason
          : `Pitch over ${formatClock(durationMs)}: median ${Math.round(c.medianF0Hz!)} Hz, range ${c.rangeSemitones!.toFixed(1)} semitones (5th–95th percentile)${c.loudnessRangeDb != null ? `; loudness varies by ${c.loudnessRangeDb.toFixed(0)} dB` : ""}. The dashed line is your median pitch, the faint line along the bottom is loudness; gaps are unvoiced or silent.`}
      </figcaption>
    </figure>
  );
}
