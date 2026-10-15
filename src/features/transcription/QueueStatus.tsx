import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranscriptionQueue } from "./queue";

/** "Transcribing 2 of 7" in the top bar while the queue works, with Stop; hidden otherwise. */
export function TranscriptionQueueStatus() {
  const queue = useTranscriptionQueue();
  if (!queue.current && queue.waiting.length === 0) return null;
  const position = Math.min(queue.total, queue.done + queue.failed + 1);
  return (
    <div role="status" className="flex h-9 shrink-0 items-center gap-2 rounded-full border bg-secondary/50 pr-1 pl-3 text-meta">
      <Loader2 aria-hidden className="size-3.5 animate-spin text-primary" />
      <span className="tabular-nums">
        Transcribing {queue.total > 1 ? `${position} of ${queue.total}` : "a take"}
        <span className="sr-only"> on this computer</span>
      </span>
      <Button variant="ghost" size="icon-xs" className="size-7 rounded-full" aria-label="Stop transcribing" title="Stop transcribing" onClick={queue.cancel}>
        <X aria-hidden />
      </Button>
    </div>
  );
}
