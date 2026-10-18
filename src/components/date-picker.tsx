import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDay } from "@/lib/format";
import { usePreferences } from "@/lib/ipc/queries";
import { cn } from "@/lib/utils";

/**
 * A day picker: a button showing the day that opens the calendar (roadmap
 * 14.2). Never a native date input. The week starts as in Settings.
 */
export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  label,
  className,
}: {
  id?: string;
  value: string;
  onChange: (day: string) => void;
  min?: string;
  max?: string;
  /** Names the button and the calendar, e.g. "Day of Run-through 1". */
  label: string;
  className?: string;
}) {
  const { preferences } = usePreferences();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" aria-label={`${label}: ${formatDay(value)}`} className={cn("justify-start font-normal tabular-nums", className)}>
          <CalendarDays aria-hidden className="text-muted-foreground" />
          {formatDay(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <Calendar
          value={value}
          min={min}
          max={max}
          label={label}
          weekStartsOn={preferences.weekStartsOn}
          onSelect={(day) => {
            onChange(day);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
