import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePreferences } from "@/lib/ipc/queries";

type Step = { route: string; target: string | null; title: string; body: string };

/**
 * The guided tour (user request 2026-10-10): what each part of the app is for
 * and where to click, page by page. Targets are `data-tour` names; a step whose
 * target isn't on screen (no takes yet, for example) is shown without a spotlight.
 */
export const TOUR_STEPS: Step[] = [
  { route: "/", target: "start", title: "Start here", body: "Today's practice is a short sequence of exercises chosen for you. Press Start practice and follow the steps; you can stop whenever you like." },
  { route: "/", target: "focus", title: "Today's focus", body: "One thing to keep in mind today. It also appears inside the recorder while you speak." },
  { route: "/", target: "week", title: "Your week", body: "A dot for each day you practised. “Your year” opens the full activity calendar." },
  { route: "/practice/ex-repeat", target: "record", title: "Record a take", body: "Press Record, or Ctrl+Enter. Before you start, the waveform already moves with your voice so you can check the microphone; nothing is recorded until you press Record." },
  { route: "/practice/ex-repeat", target: "focus-switcher", title: "One thing to change", body: "Today's focus is picked for you. Use the arrows to choose another, or the pencil to write your own." },
  { route: "/practice/ex-repeat", target: "takes", title: "Your takes", body: "Each take appears here. Once it is transcribed you see what went well and one thing to try, right under the take." },
  { route: "/sessions", target: "sessions-table", title: "Sessions", body: "Everything you recorded. Tick sessions to transcribe all their takes or move them to Trash; the Transcript column shows what is done. Click a column header to sort." },
  { route: "/sessions", target: "trash", title: "Trash", body: "Sessions and takes you delete wait here, so you can restore them until the Trash is emptied." },
  { route: "/phrases", target: "phrases-actions", title: "Phrases", body: "Keep expressions you want to use more. Add them yourself or let AI suggest some from your sessions; they come back for review on a simple schedule." },
  { route: "/progress", target: "activity", title: "Your year", body: "Every day you practised, darker for more speaking time. Click a day to see its sessions." },
  { route: "/settings/transcription", target: "whisper", title: "Transcription on this computer", body: "Download local Whisper once to transcribe takes on this computer: free, private and offline." },
  { route: "/", target: "help", title: "Help is always here", body: "Ctrl+K searches everything, Alt+← goes back, and ? lists every shortcut. Take this tour again from this Help menu." },
];

interface Tour {
  active: boolean;
  start: () => void;
}

const TourContext = createContext<Tour>({ active: false, start: () => {} });

export function useTour() {
  return useContext(TourContext);
}

const CARD_WIDTH = 340;
const PAD = 6;

/** Where the card goes: below the target if there is room, otherwise above, kept inside the window. */
function place(rect: DOMRect | null, cardHeight: number) {
  if (!rect) return { top: Math.max(16, window.innerHeight / 2 - cardHeight / 2), left: Math.max(16, window.innerWidth / 2 - CARD_WIDTH / 2) };
  const below = rect.bottom + PAD + 12;
  const top = below + cardHeight < window.innerHeight - 16 ? below : Math.max(16, rect.top - PAD - 12 - cardHeight);
  const left = Math.min(Math.max(16, rect.left), window.innerWidth - CARD_WIDTH - 16);
  return { top, left };
}

function TourOverlay({ index, onBack, onNext, onClose }: { index: number; onBack: () => void; onNext: () => void; onClose: () => void }) {
  const step = TOUR_STEPS[index];
  const card = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardHeight, setCardHeight] = useState(180);

  // Find the target (it may appear after the page loads), bring it into view, and follow it.
  useEffect(() => {
    let frame = 0;
    let found: Element | null = null;
    const startedAt = performance.now();
    const track = () => {
      if (step.target) {
        const el = document.querySelector(`[data-tour="${step.target}"]`);
        if (el && el !== found) {
          found = el;
          el.scrollIntoView({ block: "center", behavior: "auto" });
        }
        if (found?.isConnected) {
          const next = found.getBoundingClientRect();
          setRect((r) => (r && r.top === next.top && r.left === next.left && r.width === next.width && r.height === next.height ? r : next));
        } else if (performance.now() - startedAt > 1500) {
          setRect(null);
        }
      } else {
        setRect(null);
      }
      frame = requestAnimationFrame(track);
    };
    setRect(null);
    frame = requestAnimationFrame(track);
    return () => cancelAnimationFrame(frame);
  }, [step]);

  useLayoutEffect(() => {
    if (card.current) setCardHeight(card.current.offsetHeight);
  });
  useEffect(() => {
    card.current?.focus();
  }, [index]);

  const position = place(rect, cardHeight);
  const last = index === TOUR_STEPS.length - 1;
  return (
    <>
      {/* The page stays visible and usable; everything but the target is dimmed. */}
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[60] rounded-lg ring-2 ring-primary"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, boxShadow: "0 0 0 9999px var(--cp-scrim)" }}
        />
      ) : (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] bg-[var(--cp-scrim)]" />
      )}
      <div
        ref={card}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        className="fixed z-[61] space-y-3 rounded-panel border bg-popover p-4 text-popover-foreground shadow-lg outline-none"
        style={{ top: position.top, left: position.left, width: CARD_WIDTH, maxWidth: "calc(100vw - 32px)" }}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-meta text-muted-foreground tabular-nums">Step {index + 1} of {TOUR_STEPS.length}</p>
            <h2 id="tour-title" className="font-semibold">{step.title}</h2>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Close the tour" onClick={onClose}>
            <X aria-hidden />
          </Button>
        </div>
        <p id="tour-body">{step.body}</p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Skip tour</Button>
          <div className="ml-auto flex gap-2">
            {index > 0 && <Button variant="outline" size="sm" onClick={onBack}>Back</Button>}
            <Button size="sm" onClick={onNext}>{last ? "Finish" : "Next"}</Button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Runs the tour across pages: it opens each step's page, and starts by itself
 * once on Today after first-launch setup. Finishing or skipping is remembered.
 */
export function TourProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { preferences, update } = usePreferences();
  const [index, setIndex] = useState<number | null>(null);
  const autoStarted = useRef(false);

  const go = useCallback(
    (next: number) => {
      setIndex(next);
      if (location.pathname !== TOUR_STEPS[next].route) navigate(TOUR_STEPS[next].route);
    },
    [location.pathname, navigate],
  );
  const close = useCallback(() => {
    setIndex(null);
    if (!preferences.tourDone) update({ tourDone: true });
  }, [preferences.tourDone, update]);

  useEffect(() => {
    if (autoStarted.current || !preferences.onboarded || preferences.tourDone || location.pathname !== "/") return;
    autoStarted.current = true;
    const timer = setTimeout(() => go(0), 1200);
    return () => clearTimeout(timer);
  }, [preferences.onboarded, preferences.tourDone, location.pathname, go]);

  const value = useMemo<Tour>(() => ({ active: index !== null, start: () => go(0) }), [index, go]);
  return (
    <TourContext.Provider value={value}>
      {children}
      {index !== null && (
        <TourOverlay
          index={index}
          onBack={() => go(Math.max(0, index - 1))}
          onNext={() => (index === TOUR_STEPS.length - 1 ? close() : go(index + 1))}
          onClose={close}
        />
      )}
    </TourContext.Provider>
  );
}
