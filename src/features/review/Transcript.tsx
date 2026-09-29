import { Fragment, useState } from "react";
import { Check, Volume2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/format";
import type { Annotation, TranscriptRevision, TranscriptSegment } from "@/lib/ipc/schemas";
import { cn } from "@/lib/utils";

type ReviewState = Annotation["reviewState"];

const CATEGORY_LABEL: Record<Annotation["category"], string> = {
  filler_candidate: "Possible filler",
  repetition_candidate: "Possible repetition",
  note: "Note",
};

/** Splits segment text into plain runs and annotated spans (annotations must not overlap). */
function pieces(seg: TranscriptSegment, annotations: Annotation[]) {
  const own = annotations.filter((a) => a.segmentId === seg.id).sort((a, b) => a.start - b.start);
  const out: { text: string; annotation?: Annotation }[] = [];
  let at = 0;
  for (const a of own) {
    if (a.start > at) out.push({ text: seg.text.slice(at, a.start) });
    out.push({ text: seg.text.slice(a.start, a.end), annotation: a });
    at = a.end;
  }
  if (at < seg.text.length) out.push({ text: seg.text.slice(at) });
  return out;
}

/**
 * Segment-level transcript (§6 Session review). Clicking a segment seeks near its audio.
 * Candidate annotations get a neutral underline and a small Hear it / Confirm / Dismiss panel.
 */
export function Transcript({
  revision,
  positionMs,
  onSeek,
  onPlayRange,
}: {
  revision: TranscriptRevision;
  positionMs: number;
  onSeek: (ms: number) => void;
  onPlayRange: (startMs: number) => void;
}) {
  // M1: review decisions are kept in memory. From M3 they're saved so a dismissed candidate stays dismissed.
  const [decisions, setDecisions] = useState<Record<string, ReviewState>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const stateOf = (a: Annotation) => decisions[a.id] ?? a.reviewState;

  return (
    <div className="space-y-1">
      {revision.segments.map((seg) => {
        const active = positionMs >= seg.startMs && positionMs < seg.endMs;
        const selectedAnn = revision.annotations.find((a) => a.id === selected && a.segmentId === seg.id);
        return (
          <div key={seg.id} className={cn("group rounded-lg px-3 py-2 transition-quiet", active && "bg-secondary")}>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => onSeek(seg.startMs)}
                className="mt-1 shrink-0 self-start rounded text-meta text-muted-foreground tabular-nums hover:text-foreground"
                aria-label={`Play from ${formatClock(seg.startMs)}`}
              >
                {formatClock(seg.startMs)}
              </button>
              <p className="text-transcript">
                {pieces(seg, revision.annotations).map((p, i) => {
                  if (!p.annotation) return <Fragment key={i}>{p.text}</Fragment>;
                  const st = stateOf(p.annotation);
                  if (st === "dismissed") return <Fragment key={i}>{p.text}</Fragment>;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelected(selected === p.annotation!.id ? null : p.annotation!.id)}
                      aria-expanded={selected === p.annotation.id}
                      aria-label={`${p.text}: ${CATEGORY_LABEL[p.annotation.category].toLowerCase()}, ${st}`}
                      className={cn(
                        "rounded-sm underline decoration-2 underline-offset-4",
                        st === "confirmed"
                          ? "bg-highlight text-highlight-foreground decoration-foreground/60"
                          : "decoration-muted-foreground/50 decoration-dashed hover:bg-highlight",
                      )}
                    >
                      {p.text}
                    </button>
                  );
                })}
              </p>
            </div>

            {selectedAnn && (
              <div
                role="group"
                aria-label="Review candidate"
                className="mt-2 ml-12 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 text-meta"
              >
                <span className="px-1">
                  {CATEGORY_LABEL[selectedAnn.category]}: “{seg.text.slice(selectedAnn.start, selectedAnn.end)}”
                  <span className="text-muted-foreground"> · a candidate, not a certainty</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => onPlayRange(seg.startMs)}>
                  <Volume2 aria-hidden /> Hear it
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDecisions((d) => ({ ...d, [selectedAnn.id]: "confirmed" }));
                    setSelected(null);
                  }}
                >
                  <Check aria-hidden /> Confirm
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDecisions((d) => ({ ...d, [selectedAnn.id]: "dismissed" }));
                    setSelected(null);
                  }}
                >
                  <X aria-hidden /> Dismiss
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
