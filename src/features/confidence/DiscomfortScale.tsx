import { useId } from "react";
import { EvidenceLabel } from "@/components/evidence";
import { Slider } from "@/components/ui/slider";

/** "6 of 10", never "6/10" (A-26). */
export const ofTen = (n: number) => `${n} of 10`;

/**
 * The 0–10 discomfort scale (roadmap 12.2): your own reading, labelled Your
 * note, with anchors at None, Noticeable and Very strong. It is never measured
 * from your voice.
 */
export function DiscomfortScale({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const id = useId();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={id} className="font-medium">{label}</span>
        <span className="flex items-center gap-2">
          <span className="text-meta font-medium tabular-nums">{ofTen(value)}</span>
          <EvidenceLabel source="note" />
        </span>
      </div>
      <Slider min={0} max={10} step={1} value={[value]} onValueChange={([v]) => onChange(v)} aria-labelledby={id} aria-valuetext={ofTen(value)} />
      <div aria-hidden className="flex justify-between text-meta text-muted-foreground">
        <span>0 None</span>
        <span>5 Noticeable</span>
        <span>10 Very strong</span>
      </div>
    </div>
  );
}
