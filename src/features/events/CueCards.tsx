import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { LoadingBlock, Page, QueryView } from "@/components/page";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/format";
import { useTalk } from "@/lib/ipc/queries";
import type { TalkSection } from "@/lib/ipc/schemas";
import { cn } from "@/lib/utils";

/** Keys that leave cue cards alone: typing in a field, and Space on a button (it presses the button). */
function ownedByControl(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return e.key === " " && (target.tagName === "BUTTON" || target.getAttribute("role") === "button" || target.tagName === "A");
}

/**
 * Cue cards (roadmap 14.3): one card per section with its big title, up to
 * three keywords and its target time. → , Page Down or Space go on; ← or
 * Page Up go back (presenter clickers send Page Down and Page Up); Esc exits.
 */
export function CueCardDeck({
  sections,
  index,
  onIndex,
  onExit,
  footer,
  className,
}: {
  sections: readonly TalkSection[];
  index: number;
  onIndex: (index: number) => void;
  onExit?: () => void;
  /** Under the card, e.g. the recorder while rehearsing. */
  footer?: ReactNode;
  className?: string;
}) {
  const state = useRef({ index, count: sections.length, onIndex, onExit });
  state.current = { index, count: sections.length, onIndex, onExit };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || ownedByControl(e)) return;
      if (document.querySelector("[role=alertdialog], [role=dialog]")) return;
      const { index: i, count, onIndex: go, onExit: exit } = state.current;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        if (i < count - 1) go(i + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        if (i > 0) go(i - 1);
      } else if (e.key === "Escape" && exit) {
        e.preventDefault();
        exit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const section = sections[Math.min(index, sections.length - 1)];
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div aria-live="polite" className="sr-only">{`Card ${index + 1} of ${sections.length}: ${section.title}`}</div>
      <section aria-label="Cue card" className="flex min-h-[18rem] flex-1 flex-col items-center justify-center gap-6 rounded-panel border bg-card px-6 py-10 text-center">
        <p className="text-meta text-muted-foreground tabular-nums">{index + 1} of {sections.length}</p>
        <h2 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">{section.title}</h2>
        {section.keywords.length > 0 && (
          <ul className="flex flex-wrap justify-center gap-3" aria-label="Keywords">
            {section.keywords.map((k) => <li key={k} className="rounded-full border px-4 py-1.5 text-xl">{k}</li>)}
          </ul>
        )}
        <p className="text-meta text-muted-foreground tabular-nums">Target {formatClock(section.targetSeconds * 1000)}</p>
      </section>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label="Previous card"><ChevronLeft aria-hidden /> Back</Button>
        <Button variant="outline" disabled={index >= sections.length - 1} onClick={() => onIndex(index + 1)} aria-label="Next card">Next <ChevronRight aria-hidden /></Button>
        {onExit && <Button variant="ghost" onClick={onExit}><X aria-hidden /> Exit</Button>}
      </div>
      <p className="text-center text-meta text-muted-foreground">→, Page Down or Space for the next card · ← or Page Up to go back{onExit ? " · Esc to exit" : ""}</p>
      {footer}
    </div>
  );
}

/** Cue cards for a talk, filling the window: /events/talks/:talkId/cards. */
export function CueCardsPage() {
  const { talkId } = useParams();
  const talk = useTalk(talkId);
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  return (
    <Page>
      <QueryView query={talk} loading={<LoadingBlock rows={3} label="Loading the cue cards" />}>
        {(t) => (
          <div className="fixed inset-0 z-50 flex flex-col bg-background p-6">
            <p className="mb-4 text-center text-meta text-muted-foreground">
              {t.talk.title} · <Link className="underline" to={`/events/talks/${t.talk.id}`}>Back to the outline</Link>
            </p>
            <CueCardDeck sections={t.sections} index={index} onIndex={setIndex} onExit={() => navigate(`/events/talks/${t.talk.id}`)} className="mx-auto w-full max-w-4xl flex-1" />
          </div>
        )}
      </QueryView>
    </Page>
  );
}
