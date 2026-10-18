import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { parseLocalDate, UI_LOCALE } from "@/lib/format"
import { addLocalDays, toLocalDate } from "@/lib/phrase-schedule"
import { cn } from "@/lib/utils"

/**
 * A month calendar for picking a local day (YYYY-MM-DD), drawn here rather
 * than a native date input (roadmap 14.2). Arrow keys move by day and week,
 * Page Up and Page Down by month (with Shift, by year), Home and End to the
 * ends of the week; Enter or Space chooses.
 */
export type CalendarProps = {
  value: string | null
  onSelect: (day: string) => void
  min?: string
  max?: string
  weekStartsOn?: "monday" | "sunday"
  today?: string
  /** Names the grid for screen readers. */
  label?: string
  className?: string
}

const monthFmt = new Intl.DateTimeFormat(UI_LOCALE, { month: "long", year: "numeric" })
const fullFmt = new Intl.DateTimeFormat(UI_LOCALE, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
const shortDay = new Intl.DateTimeFormat(UI_LOCALE, { weekday: "short" })
const longDay = new Intl.DateTimeFormat(UI_LOCALE, { weekday: "long" })

const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`

/** The same day of the month `n` months away, or that month's last day. */
function addMonths(day: string, n: number): string {
  const d = parseLocalDate(day)
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return toLocalDate(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last)))
}

function Calendar({ value, onSelect, min, max, weekStartsOn = "monday", today = toLocalDate(new Date()), label = "Choose a day", className }: CalendarProps) {
  const clamp = React.useCallback((day: string) => (min && day < min ? min : max && day > max ? max : day), [min, max])
  const [focused, setFocused] = React.useState(() => clamp(value ?? today))
  const [month, setMonth] = React.useState(() => firstOfMonth(clamp(value ?? today)))
  const table = React.useRef<HTMLTableElement>(null)
  const byKeyboard = React.useRef(false)
  const captionId = React.useId()

  React.useEffect(() => {
    if (!byKeyboard.current) return
    byKeyboard.current = false
    table.current?.querySelector<HTMLButtonElement>(`button[data-day="${focused}"]`)?.focus()
  }, [focused, month])

  const back = (parseLocalDate(month).getDay() + (weekStartsOn === "monday" ? 6 : 0)) % 7
  const first = addLocalDays(month, -back)
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addLocalDays(first, w * 7 + d)))
  const outside = (day: string) => (!!min && day < min) || (!!max && day > max)

  const moveTo = (day: string) => {
    const next = clamp(day)
    byKeyboard.current = true
    setFocused(next)
    if (firstOfMonth(next) !== month) setMonth(firstOfMonth(next))
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const index = (parseLocalDate(focused).getDay() + (weekStartsOn === "monday" ? 6 : 0)) % 7
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addLocalDays(focused, -1),
      ArrowRight: () => addLocalDays(focused, 1),
      ArrowUp: () => addLocalDays(focused, -7),
      ArrowDown: () => addLocalDays(focused, 7),
      PageUp: () => addMonths(focused, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, e.shiftKey ? 12 : 1),
      Home: () => addLocalDays(focused, -index),
      End: () => addLocalDays(focused, 6 - index),
    }
    const move = moves[e.key]
    if (!move) return
    e.preventDefault()
    moveTo(move())
  }
  const showMonth = (n: number) => {
    const next = addMonths(month, n)
    setMonth(firstOfMonth(next))
    setFocused(clamp(firstOfMonth(next) === firstOfMonth(focused) ? focused : next))
  }
  const prevDisabled = !!min && addLocalDays(month, -1) < min
  const nextDisabled = !!max && addMonths(month, 1) > max

  return (
    <div data-slot="calendar" className={cn("w-fit space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Previous month" disabled={prevDisabled} onClick={() => showMonth(-1)}>
          <ChevronLeft aria-hidden />
        </Button>
        <p id={captionId} aria-live="polite" className="font-medium">
          {monthFmt.format(parseLocalDate(month))}
        </p>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Next month" disabled={nextDisabled} onClick={() => showMonth(1)}>
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <table ref={table} role="grid" aria-label={label} aria-describedby={captionId} className="border-collapse" onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {weeks[0].map((day) => (
              <th key={day} scope="col" abbr={longDay.format(parseLocalDate(day))} className="size-10 text-center text-meta font-normal text-muted-foreground">
                {shortDay.format(parseLocalDate(day)).slice(0, 2)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => {
                const selected = day === value
                const inMonth = day.slice(0, 7) === month.slice(0, 7)
                return (
                  <td key={day} aria-selected={selected} className="p-0 text-center">
                    <button
                      type="button"
                      data-day={day}
                      tabIndex={day === focused ? 0 : -1}
                      disabled={outside(day)}
                      aria-label={fullFmt.format(parseLocalDate(day))}
                      aria-current={day === today ? "date" : undefined}
                      onClick={() => {
                        setFocused(day)
                        onSelect(day)
                      }}
                      onFocus={() => setFocused(day)}
                      className={cn(
                        "inline-flex size-10 items-center justify-center rounded-lg text-body tabular-nums outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40",
                        !inMonth && "text-muted-foreground",
                        day === today && !selected && "font-semibold underline underline-offset-4",
                        selected && "bg-primary text-primary-foreground hover:bg-primary/80",
                      )}
                    >
                      {Number(day.slice(8))}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export { Calendar }
