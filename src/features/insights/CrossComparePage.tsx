import { Link, useSearchParams } from "react-router";
import { History } from "lucide-react";
import { LoadingBlock, Page, PageHeader, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { formatClock, formatDay } from "@/lib/format";
import { usePracticeFacts, useSessions } from "@/lib/ipc/queries";
import type { FactTake, PracticeFacts, SessionDetail, SessionSummary } from "@/lib/ipc/schemas";
import { AbListen, type AttemptRef } from "./AbListen";

const refFor = (take: FactTake): AttemptRef => ({ attemptId: take.id, sessionId: take.sessionId, label: `Take ${take.ordinal} · ${formatDay(take.localDate)} · ${formatClock(take.durationMs)}` });

/**
 * Takes from other sessions worth hearing next to this one (8.5): your first
 * answer to the same prompt, and your first take ever (the baseline, when you
 * recorded one). Both open A/B listening at /compare.
 */
export function earlierTakes(facts: PracticeFacts, session: { id: string; contentId?: string | null }): { samePrompt: FactTake | null; baseline: FactTake | null } {
  const first = (sessionIds: Set<string>) => facts.takes.filter((t) => sessionIds.has(t.sessionId)).sort((x, y) => x.createdAt.localeCompare(y.createdAt))[0] ?? null;
  const others = facts.sessions.filter((s) => s.id !== session.id);
  const samePrompt = session.contentId ? first(new Set(others.filter((s) => s.contentId === session.contentId).map((s) => s.id))) : null;
  const tagged = others.filter((s) => s.tags.includes("baseline")).map((s) => s.id);
  const baseline = first(new Set(tagged.length > 0 ? tagged : others.map((s) => s.id)));
  return { samePrompt, baseline: baseline && baseline.id !== samePrompt?.id ? baseline : null };
}

/** Links to A/B listening with an earlier answer, shown in a session's comparison. */
export function EarlierAnswers({ session, attemptId }: { session: SessionDetail; attemptId: string }) {
  const facts = usePracticeFacts();
  if (!facts.data || !attemptId) return null;
  const { samePrompt, baseline } = earlierTakes(facts.data, session);
  if (!samePrompt && !baseline) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <History aria-hidden className="size-4 text-muted-foreground" />
      <span className="text-meta text-muted-foreground">Listen next to</span>
      {samePrompt && (
        <Button variant="outline" size="sm" asChild>
          <Link to={`/compare?a=${encodeURIComponent(samePrompt.id)}&b=${encodeURIComponent(attemptId)}`}>an earlier answer to this prompt ({formatDay(samePrompt.localDate)})</Link>
        </Button>
      )}
      {baseline && (
        <Button variant="outline" size="sm" asChild>
          <Link to={`/compare?a=${encodeURIComponent(baseline.id)}&b=${encodeURIComponent(attemptId)}`}>your first take ({formatDay(baseline.localDate)})</Link>
        </Button>
      )}
    </div>
  );
}

/** A/B listening between takes of different sessions: /compare?a=<attemptId>&b=<attemptId> (8.5). */
export function CrossComparePage() {
  const [params] = useSearchParams();
  const facts = usePracticeFacts();
  const sessions = useSessions({});
  const a = facts.data?.takes.find((t) => t.id === params.get("a"));
  const b = facts.data?.takes.find((t) => t.id === params.get("b"));
  const title = (id: string | undefined) => sessions.data?.find((s: SessionSummary) => s.id === id)?.title ?? "Your takes";
  return (
    <Page className="max-w-5xl">
      <PageHeader title="Compare takes" description="Two takes from different sessions, at the same point and matched loudness." />
      {facts.isPending ? (
        <LoadingBlock rows={3} label="Loading takes" />
      ) : !a || !b || a.id === b.id ? (
        <Panel>
          <p>One of these takes is unavailable. It may be in Trash or deleted.</p>
          <Button variant="outline" className="mt-3" asChild><Link to="/sessions">Open Sessions</Link></Button>
        </Panel>
      ) : (
        <AbListen a={refFor(a)} b={refFor(b)} sessionTitle={`“${title(b.sessionId)}”`} />
      )}
    </Page>
  );
}
