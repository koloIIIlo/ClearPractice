import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EvidenceLabel } from "@/components/evidence";
import { EmptyState, LoadingBlock, Page, PageHeader, Panel, QueryView, SectionTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatClock, formatDay } from "@/lib/format";
import { useRehearsals, useTalk } from "@/lib/ipc/queries";
import type { RehearsalReport as Report } from "@/lib/ipc/schemas";

/** Over or under a target as a time: "+0:11", "−0:08". No colour and no verdict (14.3). */
export function difference(actualMs: number, targetSeconds: number): string {
  const diff = Math.round(actualMs / 1000) - targetSeconds;
  if (diff === 0) return "0:00";
  return `${diff > 0 ? "+" : "−"}${formatClock(Math.abs(diff) * 1000)}`;
}

/** The chart tokens without the red one, so no section reads as a warning. */
const CHART_COLOURS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

/**
 * A rehearsal's report (roadmap 14.3): target, actual and the difference per
 * section, from the moments you moved to each card; words, pace and hesitation
 * candidates from transcript segments that start in each section, so they are
 * approximate. Never a score.
 */
export function RehearsalReport({ report }: { report: Report }) {
  const chart = report.sections.map((s, i) => ({ name: `${i + 1}`, title: s.title, target: s.targetSeconds, actual: Math.round(s.actualMs / 1000) }));
  return (
    <div className="space-y-4">
      {report.note && <p role="note" className="rounded-lg border px-3 py-2 text-meta">{report.note}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left">
          <caption className="sr-only">Time per section</caption>
          <thead className="text-meta text-muted-foreground">
            <tr className="border-b">
              <th scope="col" className="py-2 pr-3 font-medium">Section</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Target</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Actual</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Difference</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Words</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Pace (est.)</th>
              <th scope="col" className="py-2 text-right font-medium">Hesitation candidates</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {report.sections.map((s, i) => (
              <tr key={s.sectionId} className="border-b">
                <th scope="row" className="py-2 pr-3 font-normal">{i + 1} {s.title}</th>
                <td className="py-2 pr-3 text-right">{formatClock(s.targetSeconds * 1000)}</td>
                <td className="py-2 pr-3 text-right">{s.reached ? formatClock(s.actualMs) : <span className="text-muted-foreground">Not reached</span>}</td>
                <td className="py-2 pr-3 text-right">{s.reached ? difference(s.actualMs, s.targetSeconds) : ""}</td>
                <td className="py-2 pr-3 text-right">{s.reached ? (s.words ?? "–") : "–"}</td>
                <td className="py-2 pr-3 text-right">{s.reached && s.paceWpm !== null ? `${Math.round(s.paceWpm)} wpm` : "–"}</td>
                <td className="py-2 text-right">{s.reached ? (s.hesitations ?? "–") : "–"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="font-medium tabular-nums">
            <tr>
              <th scope="row" className="py-2 pr-3">Total</th>
              <td className="py-2 pr-3 text-right">{formatClock(report.totalTargetSeconds * 1000)}</td>
              <td className="py-2 pr-3 text-right">{formatClock(report.totalActualMs)}</td>
              <td className="py-2 pr-3 text-right">{difference(report.totalActualMs, report.totalTargetSeconds)}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
        <EvidenceLabel source="estimated" />
        {report.transcribed
          ? "Times come from when you moved to each card. Words, pace and hesitation candidates come from transcript sentences that start in each section, so they are approximate."
          : "Times come from when you moved to each card. Transcribe the take to see words, pace and hesitation candidates per section."}
      </div>
      <div className="h-56" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} accessibilityLayer={false} tabIndex={-1}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={13} />
            <YAxis stroke="var(--muted-foreground)" fontSize={13} width={48} tickFormatter={(v: number) => formatClock(v * 1000)} />
            <Tooltip
              labelFormatter={(_, payload) => String(payload?.[0]?.payload?.title ?? "")}
              formatter={(v, name) => [formatClock(Number(v) * 1000), name === "target" ? "Target" : "Actual"]}
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }}
            />
            <Legend formatter={(v) => (v === "target" ? "Target" : "Actual")} />
            <Bar dataKey="target" fill="var(--chart-2)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="actual" fill="var(--chart-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** One line per section across your rehearsals, over time (14.3). */
function CompareRehearsals({ reports }: { reports: Report[] }) {
  const sections = reports.at(-1)!.sections;
  const data = reports.map((r, i) => ({
    name: `${i + 1}`,
    date: r.localDate,
    ...Object.fromEntries(r.sections.map((s) => [s.sectionId, Math.round(s.actualMs / 1000)])),
  }));
  return (
    <div className="space-y-3">
      <div className="h-64" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }} accessibilityLayer={false} tabIndex={-1}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={13} />
            <YAxis stroke="var(--muted-foreground)" fontSize={13} width={48} tickFormatter={(v: number) => formatClock(v * 1000)} />
            <Tooltip formatter={(v, key) => [formatClock(Number(v) * 1000), sections.find((s) => s.sectionId === key)?.title ?? String(key)]} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
            <Legend formatter={(key) => sections.find((s) => s.sectionId === key)?.title ?? String(key)} />
            {sections.map((s, i) => (
              <Line key={s.sectionId} type="monotone" dataKey={s.sectionId} stroke={CHART_COLOURS[i % CHART_COLOURS.length]} strokeWidth={2} dot isAnimationActive={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Time per section in each rehearsal</caption>
        <thead>
          <tr>
            <th scope="col">Rehearsal</th>
            {sections.map((s) => <th key={s.sectionId} scope="col">{s.title}</th>)}
          </tr>
        </thead>
        <tbody>
          {reports.map((r, i) => (
            <tr key={r.attemptId}>
              <th scope="row">{i + 1}, {formatDay(r.localDate)}</th>
              {sections.map((s) => {
                const found = r.sections.find((x) => x.sectionId === s.sectionId);
                return <td key={s.sectionId}>{found ? formatClock(found.actualMs) : "Not in this rehearsal"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A talk's rehearsal reports: /events/talks/:talkId/reports (?take= picks one). */
export function RehearsalReportsPage() {
  const { talkId } = useParams();
  const [search] = useSearchParams();
  const talk = useTalk(talkId);
  const reports = useRehearsals(talkId);
  const [chosen, setChosen] = useState<string | null>(search.get("take"));
  return (
    <Page>
      <PageHeader
        meta={talk.data?.talk.title}
        title="Rehearsal reports"
        description="Time per section in each rehearsal, next to your targets. Over and under are shown as times, nothing more."
        actions={talkId && <Button variant="outline" asChild><Link to={`/events/talks/${talkId}/rehearse`}>Rehearse again</Link></Button>}
      />
      <QueryView query={reports} loading={<LoadingBlock rows={3} label="Loading reports" />}>
        {(list) => {
          if (list.length === 0)
            return (
              <EmptyState title="No rehearsals yet" action={talkId && <Button asChild><Link to={`/events/talks/${talkId}/rehearse`}>Rehearse</Link></Button>}>
                Rehearse with cue cards and the recorder; moving to each card marks where a section starts.
              </EmptyState>
            );
          const current = list.find((r) => r.attemptId === chosen) ?? list.at(-1)!;
          return (
            <div className="space-y-6">
              {list.length > 1 && (
                <ToggleGroup type="single" variant="outline" aria-label="Rehearsal" className="flex-wrap justify-start" value={current.attemptId} onValueChange={(v) => v && setChosen(v)}>
                  {list.map((r, i) => <ToggleGroupItem key={r.attemptId} value={r.attemptId} className="h-9 px-3">{i + 1} · {formatDay(r.localDate)}</ToggleGroupItem>)}
                </ToggleGroup>
              )}
              <Panel aria-labelledby="report-heading">
                <SectionTitle id="report-heading" action={<Button size="sm" variant="ghost" asChild><Link to={`/sessions/${current.sessionId}`}>Open the take</Link></Button>}>
                  Rehearsal {list.indexOf(current) + 1} · {formatDay(current.localDate)}
                </SectionTitle>
                <RehearsalReport report={current} />
              </Panel>
              {list.length > 1 && (
                <Panel aria-labelledby="compare-heading">
                  <SectionTitle id="compare-heading">Compare rehearsals</SectionTitle>
                  <CompareRehearsals reports={list} />
                </Panel>
              )}
            </div>
          );
        }}
      </QueryView>
    </Page>
  );
}
