import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { EmptyState, LoadingBlock, Page, PageHeader, Panel, QueryView, SectionTitle } from "@/components/page";
import { EvidenceLabel } from "@/components/evidence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDay, formatRelativeDay } from "@/lib/format";
import { NativeSelect } from "@/components/ui/native-select";
import { useProgress } from "@/lib/ipc/queries";
import { useIpc } from "@/lib/ipc";
import { ProgressView, type ProgressSummary, type TransferReview } from "@/lib/ipc/schemas";
import { toLocalDate } from "@/lib/phrase-schedule";

const VIEW_LABELS: Record<ProgressView, string> = {
  rehearsed: "Rehearsed practice",
  unfamiliar: "Unfamiliar tasks",
  real: "Real conversations",
};

/** Below this many comparable values, show the recordings instead of a trend (§6 Progress). */
const MIN_POINTS_FOR_TREND = 4;

export function ProgressPage() {
  const [params, setParams] = useSearchParams();
  const view = ProgressView.safeParse(params.get("view")).data ?? "rehearsed";

  return (
    <Page>
      <PageHeader
        title="Progress"
        description="Evidence from your own recordings. Rehearsed answers, unfamiliar tasks, and real conversations are kept apart, and nothing is combined into a single score."
      />
      <Tabs value={view} onValueChange={(v) => setParams({ view: v }, { replace: true })}>
        <TabsList className="mb-6">
          {ProgressView.options.map((v) => (
            <TabsTrigger key={v} value={v}>
              {VIEW_LABELS[v]}
            </TabsTrigger>
          ))}
        </TabsList>
        {ProgressView.options.map((v) => (
          <TabsContent key={v} value={v}>
            {v === "real" ? <RealConversations /> : <ViewContent view={v} />}
          </TabsContent>
        ))}
      </Tabs>
    </Page>
  );
}

function ViewContent({ view }: { view: ProgressView }) {
  const progress = useProgress(view);
  return (
    <QueryView query={progress} loading={<LoadingBlock rows={3} label="Loading progress" />}>
      {(p) => <Summary p={p} />}
    </QueryView>
  );
}

function Summary({ p }: { p: ProgressSummary }) {
  const withPace = p.points.filter((x) => x.estimatedPaceWpm !== null);

  return (
    <div className="space-y-6">
      {p.highlight && (
        <Panel>
          <SectionTitle>Recent communication evidence</SectionTitle>
          <Link to={`/sessions/${p.highlight.sessionId}`} className="font-medium hover:underline">
            {p.highlight.title}
          </Link>
          <p className="mt-1">
            <span className="text-muted-foreground">Your chosen improvement:</span> {p.highlight.improvement}
          </p>
          <p className="mt-1 text-meta text-muted-foreground">
            {p.highlight.listenerFeedback ? `Listener: ${p.highlight.listenerFeedback}` : "No listener feedback recorded."}
          </p>
        </Panel>
      )}

      <dl className="grid grid-cols-2 gap-4 sm:max-w-md">
        <div className="rounded-panel border bg-card p-4">
          <dt className="text-meta text-muted-foreground">Practice time</dt>
          <dd className="text-2xl font-semibold tabular-nums">{p.practiceMinutes} min</dd>
        </div>
        <div className="rounded-panel border bg-card p-4">
          <dt className="text-meta text-muted-foreground">Sessions</dt>
          <dd className="text-2xl font-semibold tabular-nums">{p.completedSessions}</dd>
        </div>
      </dl>

      <Panel>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold">Estimated pace</h2>
          <EvidenceLabel source="estimated" />
        </div>
        {withPace.length < MIN_POINTS_FOR_TREND ? (
          <EmptyState title="More comparable sessions are needed for a trend">
            <p>
              {withPace.length === 0 ? "None yet" : `${withPace.length} so far`}. Until then, listen to the recordings
              themselves:
            </p>
            <ul className="mt-2 space-y-1">
              {p.points
                .filter((x) => x.sessionId)
                .map((x) => (
                  <li key={x.sessionId}>
                    <Link to={`/sessions/${x.sessionId}`} className="text-primary hover:underline">
                      {formatDay(x.date)}
                    </Link>
                  </li>
                ))}
            </ul>
          </EmptyState>
        ) : (
          <>
            <div className="h-64" aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={p.points} margin={{ top: 8, right: 16, bottom: 20, left: 8 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDay}
                    stroke="var(--muted-foreground)"
                    fontSize={12}
                    label={{ value: "Session date", position: "insideBottom", offset: -12, fill: "var(--muted-foreground)", fontSize: 12 }}
                  />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={12}
                    domain={["dataMin - 15", "dataMax + 15"]}
                    label={{ value: "words / min", angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 12 }}
                  />
                  <Tooltip
                    labelFormatter={(d) => formatDay(String(d))}
                    formatter={(v) => [`${v} words/min`, "Estimated pace"]}
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }}
                  />
                  <Line
                    type="linear"
                    dataKey="estimatedPaceWpm"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    dot={{ r: 4, fill: "var(--chart-1)" }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-meta text-muted-foreground">
              Gaps are sessions without a usable transcript. A different pace isn't better or worse by itself.
            </p>
          </>
        )}
        <details className="mt-3 text-meta">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show data as a table</summary>
          <table className="mt-2 w-full max-w-md text-left">
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 font-medium">Date</th>
                <th scope="col" className="py-1 text-right font-medium">Estimated pace</th>
                <th scope="col" className="py-1 text-right font-medium">Ease (self-report, 1–5)</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {p.points.map((x, i) => (
                <tr key={i}>
                  <td className="py-1">{formatDay(x.date)}</td>
                  <td className="py-1 text-right tabular-nums">{x.estimatedPaceWpm ?? "Unavailable"}</td>
                  <td className="py-1 text-right tabular-nums">{x.ease ?? "Not given"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </Panel>
    </div>
  );
}

/** Today and the 13 days before it, newest first. */
const RECENT_DAYS = () => Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return toLocalDate(d); });

const EMPTY_REFLECTION = { situation: "", preparation: "", listenerText: "", clarification: "", success: "", selfReport: "", nextFocus: "" };

/**
 * Real-conversation reflections (4.17, §7 Transfer). No recording of anyone
 * else. The listener's own words are stored apart from your reading of the
 * conversation, and nothing is combined into a score.
 */
function RealConversations() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const reviews = useQuery({ queryKey: ["transfer-reviews"], queryFn: () => ipc.listTransferReviews() });
  const [form, setForm] = useState(EMPTY_REFLECTION);
  const [date, setDate] = useState(() => toLocalDate(new Date()));
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => ipc.addTransferReview({ ...form, localDate: date }),
    onSuccess: async () => {
      setForm(EMPTY_REFLECTION);
      toast("Reflection saved on this computer.");
      await Promise.all([qc.invalidateQueries({ queryKey: ["transfer-reviews"] }), qc.invalidateQueries({ queryKey: ["today"] })]);
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-6">
        <Panel>
          <SectionTitle>Reflect on a real conversation</SectionTitle>
          <p className="mb-4 text-muted-foreground">
            No recording of anyone else is needed. If your listener answers a question, write their words in the listener
            field. Your own reading of it goes in its own field.
          </p>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <div className="space-y-1">
                <Label htmlFor="rc-situation">Situation</Label>
                <Input id="rc-situation" maxLength={2000} placeholder="e.g. Explained a decision to a colleague" value={form.situation} onChange={set("situation")} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rc-date">Day</Label>
                <NativeSelect id="rc-date" className="w-full" value={date} onChange={(e) => setDate(e.target.value)}>
                  {RECENT_DAYS().map((d) => <option key={d} value={d}>{formatRelativeDay(d, RECENT_DAYS()[0])}</option>)}
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rc-prep">How you prepared (optional)</Label>
              <Input id="rc-prep" maxLength={2000} placeholder="e.g. Five minutes of notes, or none" value={form.preparation} onChange={set("preparation")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rc-listener">What the listener said my main point was (their words)</Label>
              <Textarea id="rc-listener" rows={2} maxLength={2000} value={form.listenerText} onChange={set("listenerText")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rc-clar">Where they asked for clarification</Label>
              <Textarea id="rc-clar" rows={2} maxLength={2000} value={form.clarification} onChange={set("clarification")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rc-success">One moment that went well</Label>
              <Textarea id="rc-success" rows={2} maxLength={2000} value={form.success} onChange={set("success")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rc-self">Your own reading of how it went</Label>
              <Textarea id="rc-self" rows={2} maxLength={2000} value={form.selfReport} onChange={set("selfReport")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rc-next">Next focus</Label>
              <Input id="rc-next" maxLength={2000} value={form.nextFocus} onChange={set("nextFocus")} />
            </div>
            <Button type="submit" disabled={save.isPending || form.situation.trim().length < 3 || !date}>Save reflection</Button>
            {save.error && <p role="alert" className="text-meta text-destructive">{save.error.message}</p>}
          </form>
        </Panel>
        <QueryView query={reviews}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState title="No reflections yet">After a real conversation, write down what the listener understood. It stays on this computer.</EmptyState>
            ) : (
              <section aria-labelledby="rc-saved" className="space-y-3">
                <h2 id="rc-saved" className="font-semibold">Your reflections ({list.length})</h2>
                <ul className="space-y-3">
                  {list.map((r) => <Reflection key={r.id} review={r} />)}
                </ul>
              </section>
            )
          }
        </QueryView>
      </div>
      <aside className="text-meta text-muted-foreground">
        <p className="mb-2 font-medium text-foreground">Questions you can ask a listener</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>What was my main point?</li>
          <li>Where was I difficult to follow?</li>
          <li>What helped?</li>
        </ul>
      </aside>
    </div>
  );
}

function Reflection({ review: r }: { review: TransferReview }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({
    mutationFn: () => ipc.deleteTransferReview(r.id),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["transfer-reviews"] }), qc.invalidateQueries({ queryKey: ["today"] })]),
  });
  const field = (label: string, value: string) => value && <div><dt className="text-meta text-muted-foreground">{label}</dt><dd>{value}</dd></div>;
  return (
    <li className="rounded-panel border bg-card p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{r.situation}</p>
          <p className="text-meta text-muted-foreground">{formatDay(r.localDate)}{r.preparation && ` · prepared: ${r.preparation}`}</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={`Remove the reflection “${r.situation}”`} onClick={() => setConfirm(true)}><Trash2 aria-hidden /></Button>
      </div>
      {r.listenerText && (
        <div className="mt-3 border-l-2 border-primary pl-3">
          <p className="text-meta text-muted-foreground">Listener feedback, entered by you</p>
          <p>“{r.listenerText}”</p>
        </div>
      )}
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        {field("Asked for clarification", r.clarification)}
        {field("Went well", r.success)}
        {field("Your reading", r.selfReport)}
        {field("Next focus", r.nextFocus)}
      </dl>
      {confirm && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-meta">
          Remove this reflection?
          <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
        </p>
      )}
      {remove.error && <p role="alert" className="text-meta text-destructive">{remove.error.message}</p>}
    </li>
  );
}
