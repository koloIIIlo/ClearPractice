import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, Compass, MessagesSquare, Mic, RotateCcw } from "lucide-react";
import { EmptyState, LoadingBlock, Page, Panel, QueryView, SectionTitle } from "@/components/page";
import { ServiceStatusLine } from "@/components/service-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatLongDay, formatRelativeDay } from "@/lib/format";
import { useTodayPlan } from "@/lib/ipc/queries";
import type { SessionLength, TodayPlan } from "@/lib/ipc/schemas";

const LENGTHS: { value: SessionLength; label: string; hint: string }[] = [
  { value: "standard", label: "About 13 minutes", hint: "Four short exercises" },
  { value: "short", label: "About 5 minutes", hint: "One prompt, two takes" },
];

export function TodayPage() {
  const [length, setLength] = useState<SessionLength>("standard");
  const plan = useTodayPlan(length);

  return (
    <Page>
      <QueryView query={plan} loading={<LoadingBlock rows={4} label="Loading today's plan" />}>
        {(p) => <TodayContent plan={p} length={length} onLengthChange={setLength} />}
      </QueryView>
    </Page>
  );
}

function TodayContent({
  plan,
  length,
  onLengthChange,
}: {
  plan: TodayPlan;
  length: SessionLength;
  onLengthChange: (l: SessionLength) => void;
}) {
  const navigate = useNavigate();
  const totalMinutes = plan.steps.reduce((n, s) => n + s.minutes, 0);
  const firstRun = !plan.lastCompleted && !plan.resumable;
  const start = () =>
    navigate(`/practice/ex-repeat?prompt=p-habit&plan=${length}`, { state: { section: "today" } });

  return (
    <>
      <header className="mb-8 space-y-2">
        <h1 className="text-title font-semibold tracking-tight">{formatLongDay(plan.localDate)}</h1>
        <ServiceStatusLine />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {firstRun ? (
            <EmptyState
              icon={Mic}
              title="Your first session starts here"
              action={
                <Button size="lg" onClick={start}>
                  Start practice
                </Button>
              }
            >
              Each take is saved as audio on this computer, along with your notes and, if you turn it on, a local
              transcript.
            </EmptyState>
          ) : (
            <Panel aria-labelledby="focus-heading" className="p-6 sm:p-8">
              <p className="text-meta font-medium text-muted-foreground">Today's focus</p>
              <h2 id="focus-heading" className="mt-1 text-2xl font-semibold tracking-tight">
                {plan.focus}
              </h2>
              <details className="mt-2 text-meta text-muted-foreground">
                <summary className="cursor-pointer select-none hover:text-foreground">Why this focus?</summary>
                <p className="mt-1 max-w-prose">
                  {plan.focusReason} You can change it at any time in the session.
                </p>
              </details>

              <fieldset className="mt-6">
                <legend className="mb-2 text-meta font-medium">Session length</legend>
                <RadioGroup
                  value={length}
                  onValueChange={(v) => onLengthChange(v as SessionLength)}
                  className="flex flex-wrap gap-3"
                >
                  {LENGTHS.map((l) => (
                    <Label
                      key={l.value}
                      htmlFor={`len-${l.value}`}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary"
                    >
                      <RadioGroupItem id={`len-${l.value}`} value={l.value} />
                      <span>
                        <span className="block font-medium">{l.label}</span>
                        <span className="block text-meta text-muted-foreground">{l.hint}</span>
                      </span>
                    </Label>
                  ))}
                </RadioGroup>
              </fieldset>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                {plan.resumable ? (
                  <>
                    <Button size="lg" asChild>
                      <Link to={`/sessions/${plan.resumable.id}`}>
                        <RotateCcw aria-hidden /> Resume session
                      </Link>
                    </Button>
                    <Button size="lg" variant="outline" onClick={start}>
                      Start fresh
                    </Button>
                  </>
                ) : (
                  <Button size="lg" onClick={start}>
                    Start practice
                  </Button>
                )}
                <span className="text-meta text-muted-foreground">
                  A suggestion, not a requirement. Stop whenever you like.
                </span>
              </div>
            </Panel>
          )}

          <section aria-labelledby="plan-heading">
            <SectionTitle id="plan-heading">
              Today's sequence · <span className="font-normal text-muted-foreground">about {totalMinutes} min</span>
            </SectionTitle>
            <ol className="divide-y rounded-panel border bg-card">
              {plan.steps.map((s, i) => (
                <li key={s.exerciseType} className="flex items-center gap-4 px-4 py-3">
                  <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-meta font-medium tabular-nums"
                  >
                    {i + 1}
                  </span>
                  <span className="flex-1">{s.title}</span>
                  <span className="text-meta text-muted-foreground tabular-nums">{s.minutes} min</span>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="weekly-heading">
            <SectionTitle id="weekly-heading">This week</SectionTitle>
            <ul className="divide-y rounded-panel border bg-card">
              <li className="flex flex-wrap items-start gap-4 px-4 py-4">
                <Compass aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Try a new situation</span>
                    <Badge variant="outline">
                      {plan.weekly.newSituation.familiarity === "unfamiliar" ? "Unfamiliar topic" : "Familiar topic"}
                    </Badge>
                  </div>
                  <p>{plan.weekly.newSituation.text}</p>
                  <p className="text-meta text-muted-foreground">{plan.weekly.newSituation.reason}</p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link
                    to={`/practice/ex-repeat?prompt=${plan.weekly.newSituation.promptId}`}
                    state={{ section: "today" }}
                  >
                    Try it <ArrowRight aria-hidden />
                  </Link>
                </Button>
              </li>
              <li className="flex flex-wrap items-start gap-4 px-4 py-4">
                <MessagesSquare aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 space-y-1">
                  <span className="font-medium">Real conversation</span>
                  <p>{plan.weekly.realConversation.task}</p>
                  <p className="text-meta text-muted-foreground">
                    Afterwards, note what the listener understood. No recording of anyone else is needed.
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/progress?view=real">Add reflection</Link>
                </Button>
              </li>
            </ul>
          </section>
        </div>

        <aside className="space-y-6" aria-label="Recent">
          {plan.lastCompleted && (
            <Panel>
              <SectionTitle>Last session</SectionTitle>
              <Link to={`/sessions/${plan.lastCompleted.id}`} className="block rounded-md hover:underline">
                {plan.lastCompleted.title}
              </Link>
              <p className="text-meta text-muted-foreground">
                {formatRelativeDay(plan.lastCompleted.localDate, plan.localDate)} · {plan.lastCompleted.attemptCount}{" "}
                {plan.lastCompleted.attemptCount === 1 ? "take" : "takes"}
              </p>
              {plan.recentReflection && (
                <blockquote className="mt-3 border-l-2 pl-3 text-muted-foreground">{plan.recentReflection}</blockquote>
              )}
            </Panel>
          )}
          {plan.duePhrase && (
            <Panel>
              <SectionTitle>Phrase to review</SectionTitle>
              <p className="font-medium">{plan.duePhrase.expression}</p>
              <p className="mt-1 text-meta text-muted-foreground">{plan.duePhrase.explanation}</p>
              <Button variant="outline" size="sm" className="mt-3" asChild>
                <Link to="/phrases">Practise due phrases</Link>
              </Button>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}
