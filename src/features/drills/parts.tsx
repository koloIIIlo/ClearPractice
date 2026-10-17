import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDay } from "@/lib/format";
import { usePracticeFacts } from "@/lib/ipc/queries";
import type { DrillType, PracticePrompt } from "@/lib/ipc/schemas";
import { usePracticeStyle } from "@/features/engagement/style";

/** Your best value of a drill result field before this play, in Playful style only (10.14). Nothing in Calm style. */
export function BestLine({ type, field, format, exclude = [], lowerIsBetter = false }: { type: DrillType; field: string; format: (v: number) => string; exclude?: readonly string[]; lowerIsBetter?: boolean }) {
  const { playful } = usePracticeStyle();
  const facts = usePracticeFacts();
  if (!playful || !facts.data) return null;
  const sessions = new Set(facts.data.sessions.filter((s) => s.exerciseType === type).map((s) => s.id));
  let best: { value: number; date: string } | null = null;
  for (const take of facts.data.takes) {
    const value = take.result?.[field];
    if (!sessions.has(take.sessionId) || exclude.includes(take.id) || value === undefined) continue;
    if (!best || (lowerIsBetter ? value < best.value : value > best.value)) best = { value, date: take.localDate };
  }
  if (!best) return null;
  return (
    <p className="text-meta text-muted-foreground">
      Your best before: {format(best.value)} ({formatDay(best.date)})
    </p>
  );
}

/** Choose one of the bundled prompts (or your own). */
export function PromptPicker({ prompts, value, onChange, label = "Question" }: { prompts: readonly PracticePrompt[]; value: string; onChange: (id: string) => void; label?: string }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {prompts.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** "0:41" for a number of milliseconds into a take. */
export const at = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
