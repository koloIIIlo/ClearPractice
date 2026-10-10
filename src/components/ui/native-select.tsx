import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * A plain <select> styled like the Select trigger, for compact forms where a
 * native list is simpler (and keyboard/screen-reader friendly by default).
 * `compact` matches small buttons (36 px); the default matches buttons (40 px).
 */
function NativeSelect({ className, compact, ...props }: React.ComponentProps<"select"> & { compact?: boolean }) {
  return (
    <div data-slot="native-select" className={cn("relative inline-flex w-fit", className)}>
      <select
        className={cn(
          "w-full appearance-none rounded-lg border border-input bg-transparent pr-8 pl-2.5 text-body transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50 [&>option]:bg-popover [&>option]:text-popover-foreground",
          compact ? "h-9" : "h-10",
        )}
        {...props}
      />
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

export { NativeSelect }
