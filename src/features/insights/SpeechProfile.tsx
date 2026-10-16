import { Link } from "react-router";
import { EvidenceLabel } from "@/components/evidence";
import { EmptyState, LoadingBlock, Panel, QueryView } from "@/components/page";
import { usePracticeFacts } from "@/lib/ipc/queries";
import { buildProfile, type ProfileRow } from "@/lib/insights/profile";
import type { PracticeFacts } from "@/lib/ipc/schemas";

function Row({ row }: { row: ProfileRow }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-baseline">
      <dt className="text-muted-foreground">{row.label}</dt>
      <dd className="min-w-0">
        {row.value ? (
          row.link ? <Link className="font-medium hover:underline" to={row.link}>{row.value}</Link> : <span className="font-medium">{row.value}</span>
        ) : (
          <span className="text-muted-foreground">Unavailable: {row.unavailableReason}</span>
        )}
        {row.detail && <span className="block text-meta text-muted-foreground">{row.detail}</span>}
      </dd>
      <dd><EvidenceLabel source={row.source} /></dd>
    </div>
  );
}

/**
 * How you typically speak (roadmap 8.7): a description, not a grade. Built
 * from the facts snapshot; every row links to where it came from or says why
 * it is missing. "Then → now" has no colours or arrows of better or worse.
 */
export function SpeechProfile() {
  const facts = usePracticeFacts();
  return (
    <QueryView query={facts} loading={<LoadingBlock rows={4} label="Loading your profile" />}>
      {(data) => <Profile facts={data} />}
    </QueryView>
  );
}

function Profile({ facts }: { facts: PracticeFacts }) {
  if (facts.takes.length === 0)
    return <EmptyState title="Your profile starts with your first take">Record a take, and how you typically speak appears here.</EmptyState>;
  const { rows, since, takes } = buildProfile(facts);
  return (
    <div className="space-y-6">
      <Panel>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Your speech profile</h2>
          <span className="text-meta text-muted-foreground">from your last {takes} {takes === 1 ? "take" : "takes"}</span>
        </div>
        <p className="mb-2 text-meta text-muted-foreground">A description, not a grade. Speakers differ; these show what's typical for you. Ranges are the middle half of your takes.</p>
        <dl className="divide-y">{rows.map((r) => <Row key={r.key} row={r} />)}</dl>
      </Panel>
      <Panel>
        <h2 className="mb-1 font-semibold">Since your first month</h2>
        {since ? (
          <dl className="divide-y">{since.map((r) => <Row key={r.key} row={r} />)}</dl>
        ) : (
          <p className="text-muted-foreground">Appears once your first 30 days and your last 30 days each have five transcribed takes.</p>
        )}
      </Panel>
    </div>
  );
}
