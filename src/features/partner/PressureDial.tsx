import { useId } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { PRESSURE_LEVELS, type PressureLevel } from "./pressure";

/**
 * Four steps of pressure (roadmap 13.5), each with its time limit and the
 * partner's manner written out, so the choice is never a guess.
 */
export function PressureDial({ value, onChange, disabled }: { value: PressureLevel; onChange: (level: PressureLevel) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="font-medium">Pressure</legend>
      <RadioGroup value={String(value)} onValueChange={(v) => onChange(Number(v) as PressureLevel)} className="grid gap-2 sm:grid-cols-2">
        {PRESSURE_LEVELS.map((p) => (
          <label
            key={p.level}
            htmlFor={`${id}-${p.level}`}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50",
              value === p.level && "border-primary bg-primary/5",
            )}
          >
            <RadioGroupItem id={`${id}-${p.level}`} value={String(p.level)} className="mt-0.5" aria-describedby={`${id}-${p.level}-text`} />
            <span className="min-w-0 space-y-0.5">
              <span className="block font-medium">
                {p.level} · {p.name}
              </span>
              <span id={`${id}-${p.level}-text`} className="block text-meta text-muted-foreground">
                {p.description}
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
