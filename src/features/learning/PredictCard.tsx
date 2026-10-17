import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { EvidenceLabel } from "@/components/evidence";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { requestEngagementRefresh } from "@/features/engagement/refresh";
import { useIpc } from "@/lib/ipc";
import { keys } from "@/lib/ipc/queries";
import type { HesitationBucket, PaceBucket, Prediction, TranscriptMeasures } from "@/lib/ipc/schemas";
import { HESITATION_CHOICES, hesitationBucket, PACE_CHOICES, paceBucket } from "@/lib/learning/predict";

/** Takes you skipped guessing for in this visit; they show their summary straight away. */
const skipped = new Set<string>();
export const wasSkipped = (attemptId: string) => skipped.has(attemptId);

/** A take's hesitations: the confirmed ones once you reviewed every candidate, else the candidates (Estimated). */
export function takeHesitations(m: Pick<TranscriptMeasures, "fillers">): { count: number; reviewed: boolean } {
  const reviewed = m.fillers.length > 0 && m.fillers.every((f) => f.decision !== null);
  return { count: reviewed ? m.fillers.filter((f) => f.decision === "confirmed").length : m.fillers.length, reviewed };
}

function Choice<T extends string>({ label, choices, value, onChange }: { label: string; choices: readonly { value: T; label: string }[]; value: T | ""; onChange: (v: T | "") => void }) {
  const id = useId();
  return (
    <div className="space-y-2">
      <p id={id} className="font-medium">{label}</p>
      <ToggleGroup type="single" variant="outline" aria-labelledby={id} value={value} onValueChange={(v) => onChange(v as T | "")} className="flex-wrap">
        {choices.map((c) => (
          <ToggleGroupItem key={c.value} value={c.value} size="sm" className="h-9 px-3">{c.label}</ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/**
 * Predict, then check (roadmap 11.5): before the take's measures show, guess
 * your hesitations and your pace. Reveal saves the guesses as Your note; Skip
 * shows the summary without saving anything.
 */
export function PredictCard({ attemptId, onSkip }: { attemptId: string; onSkip: () => void }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const [hesitations, setHesitations] = useState<HesitationBucket | "">("");
  const [pace, setPace] = useState<PaceBucket | "">("");
  const reveal = useMutation({
    mutationFn: async () => {
      if (hesitations) await ipc.setPrediction(attemptId, "hesitations", hesitations);
      if (pace) await ipc.setPrediction(attemptId, "pace", pace);
    },
    onSuccess: async () => {
      requestEngagementRefresh("review");
      await Promise.all([qc.invalidateQueries({ queryKey: keys.predictions }), qc.invalidateQueries({ queryKey: keys.facts })]);
    },
  });
  return (
    <section role="group" aria-label="Guess first" className="space-y-4 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Before you look: guess first</h3>
        <EvidenceLabel source="note" />
      </div>
      <Choice label="How many hesitations do you think you had?" choices={HESITATION_CHOICES} value={hesitations} onChange={setHesitations} />
      <Choice label="Your pace compared with usual?" choices={PACE_CHOICES} value={pace} onChange={setPace} />
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={(!hesitations && !pace) || reveal.isPending} onClick={() => reveal.mutate()}>
          Reveal
        </Button>
        <Button
          variant="ghost"
          disabled={reveal.isPending}
          onClick={() => {
            skipped.add(attemptId);
            onSkip();
          }}
        >
          Skip
        </Button>
        <span className="text-meta text-muted-foreground">Guessing first, then checking, sharpens your sense of how you sound.</span>
      </div>
      {reveal.error && <p role="alert" className="text-meta text-destructive">{reveal.error.message}</p>}
    </section>
  );
}

const label = <T extends string>(choices: readonly { value: T; label: string }[], value: string | undefined) => choices.find((c) => c.value === value)?.label ?? value;

/** Your guesses next to the take's values: the guess is Your note, the value Estimated (A-35). */
export function PredictionReveal({ predictions, measures, usualPace }: { predictions: Prediction[]; measures: TranscriptMeasures; usualPace: number | null }) {
  const guessed = (kind: Prediction["kind"]) => predictions.find((p) => p.kind === kind)?.predicted;
  const h = takeHesitations(measures);
  const actualH = hesitationBucket(h.count);
  const actualP = measures.paceWpm != null && usualPace != null ? paceBucket(measures.paceWpm, usualPace) : null;
  const rows = [
    guessed("hesitations") && {
      key: "hesitations",
      guess: label(HESITATION_CHOICES, guessed("hesitations")),
      value: `${h.count} ${h.reviewed ? (h.count === 1 ? "confirmed filler" : "confirmed fillers") : h.count === 1 ? "hesitation candidate" : "hesitation candidates"}`,
      match: guessed("hesitations") === actualH,
    },
    guessed("pace") && {
      key: "pace",
      guess: label(PACE_CHOICES, guessed("pace")),
      value: actualP ? `${label(PACE_CHOICES, actualP)?.toLowerCase()} (about ${Math.round(measures.paceWpm!)} words a minute; your usual is about ${Math.round(usualPace!)})` : "unavailable (no usual pace yet, or no pace for this take)",
      match: actualP !== null && guessed("pace") === actualP,
    },
  ].filter((r): r is { key: string; guess: string; value: string; match: boolean } => !!r);
  if (rows.length === 0) return null;
  return (
    <ul className="mb-3 space-y-1 border-b pb-3" aria-label="Your guesses">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{r.key === "pace" ? "Pace:" : "Hesitations:"} you guessed {r.guess}</span>
          <EvidenceLabel source="note" />
          <span aria-hidden className="text-muted-foreground">·</span>
          <span>{r.value}</span>
          <EvidenceLabel source="estimated" />
          {r.match && (
            <span className="inline-flex items-center gap-1 text-meta text-primary">
              <Check aria-hidden className="size-3.5" /> matched
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
