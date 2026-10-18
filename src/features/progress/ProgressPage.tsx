import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { EmptyState, LoadingBlock, Page, PageHeader, Panel, QueryView, SectionTitle } from "@/components/page";
import { EvidenceLabel } from "@/components/evidence";
import { ActivityCalendar } from "./ActivityCalendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDay, formatRelativeDay } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProgress } from "@/lib/ipc/queries";
import { useIpc } from "@/lib/ipc";
import { ProgressView, type ProgressSummary, type TransferFlow, type TransferReview, type TransferTag } from "@/lib/ipc/schemas";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SpeechProfile } from "@/features/insights/SpeechProfile";
import { AAR_QUESTIONS, FLOWS, KINDS, RECENT_DAYS } from "./reflection-options";
import { AfterActionForm } from "@/features/confidence/AfterActionForm";
import { ImportListenerAnswers, ListenerAnswers } from "@/features/events/ListenerAnswers";
import { missionById } from "@/content/missions";
import { useEvent, usePracticeFacts } from "@/lib/ipc/queries";
import { capsuleMonths } from "@/lib/capsule";
import { CapsuleChips } from "@/features/events/TimeCapsule";
import { Trends } from "@/features/insights/Trends";

/** Progress tabs: your speech profile first (8.7), then the evidence views. */
type Tab = "profile" | ProgressView;
const TABS: Tab[] = ["profile", ...ProgressView.options];
const VIEW_LABELS: Record<Tab, string> = {
  profile: "Profile",
  rehearsed: "Rehearsed practice",
  unfamiliar: "Unfamiliar tasks",
  real: "Real conversations",
};

/** Below this many comparable values, show the recordings instead of a trend (§6 Progress). */
const MIN_POINTS_FOR_TREND = 4;

/** A pace axis on round numbers: tens with some headroom, every 10 (or 20 for a wide spread). */
function paceAxis(values: number[]): { domain: [number, number]; ticks: number[] } {
  const lo = Math.floor((Math.min(...values) - 5) / 10) * 10;
  const hi = Math.ceil((Math.max(...values) + 5) / 10) * 10;
  const step = hi - lo > 60 ? 20 : 10;
  const start = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= hi; v += step) ticks.push(v);
  return { domain: [start, ticks.at(-1)!], ticks };
}

export function ProgressPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("view");
  const view: Tab = requested === "profile" ? "profile" : (ProgressView.safeParse(requested).data ?? "profile");

  return (
    <Page>
      <PageHeader
        title="Progress"
        description="Evidence from your own recordings. Rehearsed answers, unfamiliar tasks, and real conversations are kept apart, and nothing is combined into a single score."
      />
      <div className="mb-8">
        <ActivityCalendar />
      </div>
      <Tabs value={view} onValueChange={(v) => setParams({ view: v }, { replace: true })}>
        <TabsList className="mb-6">
          {TABS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {VIEW_LABELS[v]}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((v) => (
          <TabsContent key={v} value={v}>
            {v === "profile" ? <ProfileTab /> : v === "real" ? <RealConversations /> : <ViewContent view={v} />}
          </TabsContent>
        ))}
      </Tabs>
    </Page>
  );
}

/** Your speech profile (8.7), then your time capsules by month (14.5). */
function ProfileTab() {
  const facts = usePracticeFacts();
  return (
    <div className="space-y-8">
      <SpeechProfile />
      {facts.data && capsuleMonths(facts.data).length > 0 && (
        <section aria-labelledby="profile-capsules">
          <SectionTitle id="profile-capsules" action={<Button size="sm" variant="ghost" asChild><Link to="/capsule">Time capsule</Link></Button>}>Your capsules</SectionTitle>
          <CapsuleChips facts={facts.data} />
        </section>
      )}
    </div>
  );
}

function ViewContent({ view }: { view: "rehearsed" | "unfamiliar" }) {
  const progress = useProgress(view);
  return (
    <QueryView query={progress} loading={<LoadingBlock rows={3} label="Loading progress" />}>
      {(p) => (
        <div className="space-y-8">
          <Summary p={p} />
          <Trends view={view} />
        </div>
      )}
    </QueryView>
  );
}

function Summary({ p }: { p: ProgressSummary }) {
  const withPace = p.points.filter((x) => x.estimatedPaceWpm !== null);
  const axis = withPace.length > 0 ? paceAxis(withPace.map((x) => x.estimatedPaceWpm!)) : null;

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
          <dd className="text-meta text-muted-foreground">Recorded in your takes</dd>
        </div>
        <div className="rounded-panel border bg-card p-4">
          <dt className="text-meta text-muted-foreground">Sessions</dt>
          <dd className="text-2xl font-semibold tabular-nums">{p.completedSessions}</dd>
          <dd className="text-meta text-muted-foreground">With at least one take</dd>
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
            {/* Hidden from assistive technology and the Tab order: the table below carries the same data. */}
            <div className="h-64" aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={p.points} margin={{ top: 8, right: 16, bottom: 20, left: 8 }} accessibilityLayer={false} tabIndex={-1}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDay}
                    stroke="var(--muted-foreground)"
                    fontSize={13}
                    label={{ value: "Session date", position: "insideBottom", offset: -12, fill: "var(--muted-foreground)", fontSize: 13 }}
                  />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={13}
                    domain={axis?.domain}
                    ticks={axis?.ticks}
                    allowDecimals={false}
                    label={{ value: "words / min", angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 13 }}
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

const EMPTY_REFLECTION = { situation: "", preparation: "", listenerText: "", clarification: "", success: "", selfReport: "", nextFocus: "" };

/**
 * Real-conversation reflections (4.17, §7 Transfer). No recording of anyone
 * else. The listener's own words are stored apart from your reading of the
 * conversation, and nothing is combined into a score.
 */
function RealConversations() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  // A reflection, or an after-action review after a real talk (12.4): ?form=aar opens it.
  const formKind = params.get("form") === "aar" ? "aar" : "reflection";
  const setFormKind = (kind: string) =>
    setParams(
      (p) => {
        if (kind === "aar") p.set("form", "aar");
        else p.delete("form");
        return p;
      },
      { replace: true },
    );
  const reviews = useQuery({ queryKey: ["transfer-reviews"], queryFn: () => ipc.listTransferReviews() });
  // This week's mission (14.1): I did it opens the form with the mission preselected.
  const mission = missionById(params.get("mission"));
  // An event's Debrief (14.2) opens the after-action review for that event.
  const debriefOf = useEvent(formKind === "aar" ? (params.get("event") ?? undefined) : undefined).data?.event;
  const [form, setForm] = useState(() => (mission ? { ...EMPTY_REFLECTION, situation: mission.title } : EMPTY_REFLECTION));
  const [flow, setFlow] = useState<TransferFlow | null>(null);
  const [kinds, setKinds] = useState<TransferTag[]>(() => mission?.tags ?? []);
  const [days] = useState(RECENT_DAYS);
  const [date, setDate] = useState(days[0]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const dropMission = () =>
    setParams(
      (p) => {
        p.delete("mission");
        return p;
      },
      { replace: true },
    );
  const save = useMutation({ meta: { engagement: "reflection" },
    mutationFn: () => ipc.addTransferReview({ ...form, localDate: date, flow, tags: kinds, missionId: mission?.id ?? null }),
    onSuccess: async () => {
      setForm(EMPTY_REFLECTION);
      setFlow(null);
      setKinds([]);
      toast(mission ? "Mission logged with your reflection." : "Reflection saved on this computer.");
      if (mission) dropMission();
      // A mission's week is done now (14.1); the rest refreshes through the engagement tag.
      await Promise.all([qc.invalidateQueries({ queryKey: ["transfer-reviews"] }), qc.invalidateQueries({ queryKey: ["today"] }), ...(mission ? [qc.invalidateQueries({ queryKey: ["engagement", "mission"] })] : [])]);
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-6">
        <Panel>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-body font-semibold">{formKind === "aar" ? "After-action review" : "Reflect on a real conversation"}</h2>
            <ToggleGroup type="single" variant="outline" aria-label="What to write" value={formKind} onValueChange={(v) => v && setFormKind(v)}>
              <ToggleGroupItem value="reflection" size="sm" className="h-9 px-3">Reflection</ToggleGroupItem>
              <ToggleGroupItem value="aar" size="sm" className="h-9 px-3">After-action review</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {formKind === "aar" ? (
            <>
              <p className="mb-4 text-muted-foreground">Four questions after a real talk: what you planned, what happened, why, and what you'll do next time.</p>
              {debriefOf && (
                <p role="note" className="mb-4 rounded-lg border px-3 py-2 text-meta">
                  Debrief of <Link className="font-medium text-primary underline underline-offset-2" to={`/events/${debriefOf.id}`}>{debriefOf.title}</Link>. Saving it finishes the plan's Debrief.
                </p>
              )}
              <AfterActionForm key={debriefOf?.id ?? "none"} event={debriefOf ? { id: debriefOf.id, title: debriefOf.title } : undefined} />
            </>
          ) : (
          <>
          <p className="mb-4 text-muted-foreground">
            No recording of anyone else is needed. If your listener answers a question, write their words in the listener
            field. Your own reading of it goes in its own field.
          </p>
          {mission && (
            <div role="note" className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-meta">
              <span className="min-w-0 flex-1">Logging this week's mission: <span className="font-medium">{mission.title}</span></span>
              <Button type="button" size="sm" variant="ghost" onClick={dropMission}>Not a mission</Button>
            </div>
          )}
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
                <Select value={date} onValueChange={setDate}>
                  <SelectTrigger id="rc-date" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {days.map((d) => <SelectItem key={d} value={d}>{formatRelativeDay(d, days[0])}</SelectItem>)}
                  </SelectContent>
                </Select>
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
              <span id="rc-flow" className="text-body font-medium">How did your speaking flow?</span>
              <ToggleGroup type="single" variant="outline" aria-labelledby="rc-flow" className="flex-wrap justify-start" value={flow ?? ""} onValueChange={(v) => setFlow((v || null) as TransferFlow | null)}>
                {FLOWS.map((f) => <ToggleGroupItem key={f.value} value={f.value} className="h-9 px-3">{f.label}</ToggleGroupItem>)}
              </ToggleGroup>
            </div>
            <div className="space-y-1">
              <span id="rc-kind" className="text-body font-medium">What kind of conversation?</span>
              <ToggleGroup type="multiple" variant="outline" aria-labelledby="rc-kind" className="flex-wrap justify-start" value={kinds} onValueChange={(v) => setKinds(v as TransferTag[])}>
                {KINDS.map((k) => <ToggleGroupItem key={k.value} value={k.value} size="sm" className="h-9 px-3">{k.label}</ToggleGroupItem>)}
              </ToggleGroup>
              <p className="text-meta text-muted-foreground">Both are optional and saved as your note.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rc-next">Next focus</Label>
              <Input id="rc-next" maxLength={2000} value={form.nextFocus} onChange={set("nextFocus")} />
            </div>
            <Button type="submit" disabled={save.isPending || form.situation.trim().length < 3 || !date}>Save reflection</Button>
            {save.error && <p role="alert" className="text-meta text-destructive">{save.error.message}</p>}
          </form>
          </>
          )}
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
        <ListenerAnswers title="Listeners' answers" takeHref={(_, sessionId) => `/sessions/${sessionId}`} />
      </div>
      <aside className="space-y-6 text-meta text-muted-foreground">
        <div>
          <p className="mb-2 font-medium text-foreground">Questions you can ask a listener</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>What was my main point?</li>
            <li>Where was I difficult to follow?</li>
            <li>What helped?</li>
          </ul>
        </div>
        {/* Listener packs (14.4): Ask a listener is on any take; their answer files are imported here. */}
        <div className="space-y-2">
          <p className="font-medium text-foreground">A listener's answers</p>
          <p>Ask a listener about a take from the take's page, then import the answer file they send back.</p>
          <ImportListenerAnswers />
        </div>
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
          <p className="font-medium">
            {r.situation}
            {r.kind === "aar" && <span className="ml-2 rounded-md border px-1.5 py-0.5 text-meta font-medium text-muted-foreground">After-action</span>}
          </p>
          <p className="text-meta text-muted-foreground">{formatDay(r.localDate)}{r.preparation && ` · prepared: ${r.preparation}`}</p>
        </div>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Remove the reflection “${r.situation}”`} onClick={() => setConfirm(true)}><Trash2 aria-hidden /></Button>
      </div>
      {r.listenerText && (
        <div className="mt-3 border-l-2 border-primary pl-3">
          <p className="text-meta text-muted-foreground">Listener feedback, entered by you</p>
          <p>“{r.listenerText}”</p>
        </div>
      )}
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        {r.extra && AAR_QUESTIONS.map((q) => <div key={q.key} className="contents">{field(q.label, r.extra![q.key])}</div>)}
        {field("Asked for clarification", r.clarification)}
        {field("Went well", r.success)}
        {field("Your reading", r.selfReport)}
        {field("Next focus", r.nextFocus)}
        {field("How your speaking flowed", FLOWS.find((f) => f.value === r.flow)?.label ?? "")}
        {field("Kind of conversation", r.tags.map((tag) => KINDS.find((k) => k.value === tag)?.label ?? tag).join(", "))}
      </dl>
      {(r.flow || r.tags.length > 0 || r.selfReport || r.extra) && <EvidenceLabel source="note" className="mt-2" />}
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
