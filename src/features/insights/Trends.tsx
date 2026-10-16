import { Link } from "react-router";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EvidenceLabel } from "@/components/evidence";
import { LoadingBlock, Panel, QueryView } from "@/components/page";
import { formatDay } from "@/lib/format";
import { usePracticeFacts } from "@/lib/ipc/queries";
import { buildTrends, MIN_TREND_POINTS, TREND_INFO, type Trend } from "@/lib/insights/trends";

function TrendChart({ trend }: { trend: Trend }) {
  const info = TREND_INFO[trend.key];
  const data = trend.points.map((p, i) => ({ ...p, typical: trend.typical[i]?.value }));
  return (
    <Panel className="min-w-0 space-y-2 p-4" aria-label={info.title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{info.title}</h3>
          <p className="text-meta text-muted-foreground">{info.subtitle ?? info.unit}</p>
        </div>
        <EvidenceLabel source="estimated" />
      </div>
      {trend.points.length < MIN_TREND_POINTS ? (
        <p className="text-meta text-muted-foreground">
          More comparable sessions are needed for a trend ({trend.points.length === 0 ? "none yet" : `${trend.points.length} so far`}).
          {trend.points.length > 0 && (
            <>
              {" "}Latest:{" "}
              <Link className="text-primary hover:underline" to={`/sessions/${trend.points.at(-1)!.sessionId}`}>
                {formatDay(trend.points.at(-1)!.date)}
              </Link>
            </>
          )}
        </p>
      ) : (
        <>
          {/* No target line and no better-or-worse colours: your points and what's typical for you. */}
          <div className="h-40" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 6, right: 8, bottom: 4, left: 0 }} accessibilityLayer={false} tabIndex={-1}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickFormatter={formatDay} stroke="var(--muted-foreground)" fontSize={13} minTickGap={24} />
                <YAxis stroke="var(--muted-foreground)" fontSize={13} width={36} domain={["auto", "auto"]} />
                <Tooltip
                  labelFormatter={(d) => formatDay(String(d))}
                  formatter={(v, name) => [`${v} ${info.unit}`, name === "typical" ? "Typical for you" : info.title]}
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }}
                />
                <Line type="linear" dataKey="value" stroke="var(--chart-1)" strokeWidth={0} dot={{ r: 3.5, fill: "var(--chart-1)" }} isAnimationActive={false} />
                <Line type="monotone" dataKey="typical" stroke="var(--chart-4)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-meta text-muted-foreground">Dots are sessions; the line is typical for you (the median of the last five).</p>
          <details className="text-meta">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show data as a table</summary>
            <table className="mt-2 w-full text-left">
              <thead className="text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 font-medium">Date</th>
                  <th scope="col" className="py-1 text-right font-medium">{info.title}</th>
                  <th scope="col" className="py-1 text-right font-medium">Typical for you</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.map((p) => (
                  <tr key={p.sessionId}>
                    <td className="py-1"><Link className="text-primary hover:underline" to={`/sessions/${p.sessionId}`}>{formatDay(p.date)}</Link></td>
                    <td className="py-1 text-right tabular-nums">{p.value}</td>
                    <td className="py-1 text-right tabular-nums">{p.typical}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </Panel>
  );
}

/**
 * Four small trends under the pace chart (roadmap 8.6): mean run, pauses inside
 * a clause, vocabulary range and confirmed hesitations, from the same evidence
 * takes as pace. Read from the facts snapshot, so the whole grid is one call.
 */
export function Trends({ view }: { view: "rehearsed" | "unfamiliar" }) {
  const facts = usePracticeFacts();
  return (
    <section aria-labelledby={`trends-${view}`} className="space-y-3">
      <h2 id={`trends-${view}`} className="font-semibold">Trends</h2>
      <QueryView query={facts} loading={<LoadingBlock rows={2} label="Loading trends" />}>
        {(data) => (
          <div className="grid gap-4 md:grid-cols-2">
            {buildTrends(data, view).map((t) => <TrendChart key={t.key} trend={t} />)}
          </div>
        )}
      </QueryView>
    </section>
  );
}
