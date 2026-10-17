import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useIpc } from "@/lib/ipc";
import { playCue } from "@/lib/tone";
import { celebrationQueue, type Celebration } from "./queue";
import { usePracticeStyle } from "./style";
import { useDrillBusy } from "@/features/drills/busy";

/** The gap between two celebrations, and how long a card stays without hover or focus. */
const GAP_MS = 1200;
const CARD_MS = 8000;
const BUSY_PHASES = new Set(["preparing", "recording", "finalizing"]);

/**
 * Shows celebrations one at a time (roadmap 9.10): a card in the corner in
 * Full style, a toast in Subtle style or under reduced motion, nothing when
 * off. It waits while a take records and while a dialog is open, never moves
 * focus, and closes with Escape.
 */
export function CelebrationHost() {
  const ipc = useIpc();
  const navigate = useNavigate();
  const style = usePracticeStyle();
  const [pending, setPending] = useState<Celebration[]>(() => celebrationQueue.take());
  const [current, setCurrent] = useState<Celebration | null>(null);
  const [recording, setBusy] = useState(false);
  // A drill's think time records nothing, so the drill says when it is busy (10.1).
  const drillBusy = useDrillBusy();
  const busy = recording || drillBusy;
  const [retry, setRetry] = useState(0);
  const held = useRef(false);

  useEffect(() => {
    const unsubscribe = celebrationQueue.subscribe(() => setPending((p) => [...p, ...celebrationQueue.take()]));
    return () => {
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    let remove: (() => void) | undefined;
    let disposed = false;
    void ipc.onRecordingEvent((status) => setBusy(BUSY_PHASES.has(status.phase))).then((r) => (disposed ? r() : (remove = r)));
    return () => {
      disposed = true;
      remove?.();
    };
  }, [ipc]);

  // The next celebration, after a short gap, when nothing else needs you.
  useEffect(() => {
    if (current || busy || pending.length === 0) return;
    if (style.celebrations === "off") {
      setPending([]);
      return;
    }
    const timer = setTimeout(() => {
      if (document.querySelector("[role=dialog], [role=alertdialog]")) {
        setRetry((n) => n + 1);
        return;
      }
      const [next, ...rest] = pending;
      setPending(rest);
      if (style.sounds) playCue("celebrate");
      if (next.quiet || style.celebrations === "subtle") {
        toast(next.headline, { description: next.because ?? undefined, action: { label: "Journey", onClick: () => navigate("/journey") } });
        // A toast doesn't block the next one beyond the gap.
        setCurrent(null);
        setRetry((n) => n + 1);
      } else setCurrent(next);
    }, GAP_MS);
    return () => clearTimeout(timer);
  }, [current, busy, pending, retry, style.celebrations, style.sounds, navigate]);

  // A card closes by itself unless you're hovering or focused on it.
  useEffect(() => {
    if (!current) return;
    const timer = setInterval(() => {
      if (!held.current) setCurrent(null);
    }, CARD_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCurrent(null);
    };
    // Capture phase, so a toast or dialog handler can't swallow it first.
    window.addEventListener("keydown", onKey, true);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [current]);

  if (!current) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="celebration-card"
      className="fixed right-4 bottom-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] rounded-panel border bg-card p-4 shadow-lg"
      onMouseEnter={() => (held.current = true)}
      onMouseLeave={() => (held.current = false)}
      onFocus={() => (held.current = true)}
      onBlur={() => (held.current = false)}
    >
      <div className="flex items-start gap-3">
        <svg aria-hidden viewBox="0 0 36 36" className="size-10 shrink-0 -rotate-90">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--cp-ring-track)" strokeWidth="3" />
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--cp-accent)" strokeWidth="3" strokeLinecap="round" pathLength={100} strokeDasharray="100" className="animate-ring-fill" />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-semibold">
            <Sparkles aria-hidden className="size-4 text-primary" /> {current.headline}
          </p>
          {current.because && <p className="mt-0.5 text-meta text-muted-foreground">{current.because}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setCurrent(null); navigate("/journey"); }}>See in Journey</Button>
            <Button size="sm" variant="ghost" onClick={() => setCurrent(null)}>Close</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
