import { Link, useNavigate } from "react-router";
import { startSprint } from "@/features/learning/sprint";
import { CheckCircle2, CircleDashed, CircleDot, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDay } from "@/lib/format";
import { areaDef, available, LEVELS } from "@/lib/engagement/skills";
import type { AreaId, CriterionProgress, EvidenceRef, LevelStatus } from "@/lib/engagement/types";
import type { Journey } from "./useJourney";

const STATE_TEXT = { reached: "Reached", ready: "Ready: you've already met this", in_progress: "In progress", not_started: "Not yet" } as const;
const FIX_LINKS: Partial<Record<NonNullable<CriterionProgress["unavailable"]>["fix"] & string, { to: string; label: string }>> = {
  transcription: { to: "/settings/transcription", label: "Set it up" },
  review: { to: "/sessions", label: "Review a take" },
};

function Criterion({ c }: { c: CriterionProgress }) {
  const fix = c.unavailable?.fix ? FIX_LINKS[c.unavailable.fix] : undefined;
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      {c.met ? <CheckCircle2 aria-hidden className="size-4 shrink-0 translate-y-0.5 text-primary" /> : <Circle aria-hidden className="size-4 shrink-0 translate-y-0.5 text-muted-foreground" />}
      <span className="min-w-0 flex-1">{c.label}</span>
      <span className="text-meta text-muted-foreground tabular-nums">
        {c.unavailable && !c.met ? (
          <>
            {c.unavailable.reason}
            {fix && <> · <Link className="text-primary underline underline-offset-2" to={fix.to}>{fix.label}</Link></>}
          </>
        ) : (
          <>
            {c.done} of {c.needed}
            {c.days && `, on ${c.days.done} of ${c.days.needed} ${c.days.unit}`}
          </>
        )}
      </span>
    </li>
  );
}

function evidenceLink(e: EvidenceRef, journey: Journey): { to: string | null; text: string } {
  const date = formatDay(e.date);
  if (e.kind === "take") {
    const take = journey.facts.takes.find((t) => t.id === e.id);
    return take ? { to: `/sessions/${take.sessionId}/attempt/${take.ordinal}`, text: `Take ${take.ordinal}, ${date}` } : { to: null, text: "From a deleted session" };
  }
  if (e.kind === "session") {
    return journey.facts.sessions.some((s) => s.id === e.id) ? { to: `/sessions/${e.id}`, text: `Session, ${date}` } : { to: null, text: "From a deleted session" };
  }
  if (e.kind === "transfer") return { to: "/progress?view=real", text: `Real conversation, ${date}` };
  if (e.kind === "exposure") return { to: "/confidence", text: `Ladder step, ${date}` };
  return { to: "/phrases", text: `Phrase, ${date}` };
}

function Level({ level, area, journey }: { level: LevelStatus; area: AreaId; journey: Journey }) {
  const def = LEVELS[area][level.level - 1];
  const Icon = level.state === "reached" ? CheckCircle2 : level.state === "ready" ? CircleDot : level.state === "in_progress" ? CircleDashed : Circle;
  const evidence = level.criteria.flatMap((c) => c.evidence).slice(0, 10);
  const links = def.practise.filter(available);
  const open = level.state !== "reached" && level.state !== "not_started";
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Icon aria-hidden className={level.state === "reached" || level.state === "ready" ? "size-4 translate-y-0.5 text-primary" : "size-4 translate-y-0.5 text-muted-foreground"} />
        <span className="font-medium">Level {level.level} · {level.name}</span>
        <span className="text-meta text-muted-foreground">
          {level.state === "reached" && level.reachedAt ? `Reached ${formatDay(level.reachedAt.slice(0, 10))}` : STATE_TEXT[level.state]}
        </span>
      </div>
      <p className="pl-7 text-meta text-muted-foreground">{def.description}</p>
      {(open || level.state === "not_started") && (
        <ul className="space-y-1 pl-7">
          {level.criteria.map((c) => <Criterion key={c.label} c={c} />)}
        </ul>
      )}
      {open && links.length > 0 && (
        <div className="flex flex-wrap gap-2 pl-7">
          {links.map((link) => <Button key={link.label} variant="outline" size="sm" asChild><Link to={link.to}>{link.label}</Link></Button>)}
        </div>
      )}
      {level.state === "reached" && evidence.length > 0 && (
        <details className="pl-7 text-meta">
          <summary className="cursor-pointer text-muted-foreground">Evidence</summary>
          <ul className="mt-1 space-y-0.5">
            {evidence.map((e) => {
              const link = evidenceLink(e, journey);
              return <li key={`${e.kind}-${e.id}`}>{link.to ? <Link className="text-primary underline underline-offset-2" to={link.to}>{link.text}</Link> : link.text}</li>;
            })}
          </ul>
        </details>
      )}
    </li>
  );
}

/**
 * One area's five levels (roadmap 9.15): reached levels with their dates and
 * evidence, the next level's criteria with progress and places to practise.
 */
export function AreaSheet({ area, journey, onClose }: { area: AreaId | null; journey: Journey; onClose: () => void }) {
  const navigate = useNavigate();
  const status = area ? journey.areas.find((a) => a.area === area) : null;
  const def = area ? areaDef(area) : null;
  return (
    <Sheet open={!!status} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[480px]">
        {status && def && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <def.icon aria-hidden className="size-5 text-primary" /> {def.title}
              </SheetTitle>
              <SheetDescription>{def.why}</SheetDescription>
            </SheetHeader>
            {status.current < 5 && (
              <div className="flex flex-wrap items-center gap-3 px-4">
                <Button variant="outline" size="sm" onClick={() => startSprint(navigate, status.area, status.current)}>
                  5-minute sprint
                </Button>
                <span className="text-meta text-muted-foreground">Two or three short steps toward level {status.current + 1}.</span>
              </div>
            )}
            <ol className="divide-y px-4">
              {status.levels.map((l) => <Level key={l.level} level={l} area={status.area} journey={journey} />)}
            </ol>
            <details className="px-4 pb-6 text-meta">
              <summary className="cursor-pointer text-muted-foreground">How levels work</summary>
              <p className="mt-1">Levels show what you've practised and shown. They are never a grade of your English. AI suggestions don't count toward them. A level you reach is never taken away.</p>
            </details>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
