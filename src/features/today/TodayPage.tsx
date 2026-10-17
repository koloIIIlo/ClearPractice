import { lazy, Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isComeback } from "@/lib/engagement/fresh-start";
import { toLocalDate } from "@/lib/phrase-schedule";
import { usePracticeEvents, usePreferences } from "@/lib/ipc/queries";
import { Link, useNavigate } from "react-router";
import { ArrowRight, Compass, MessagesSquare, Mic, RotateCcw } from "lucide-react";
import { EmptyState, LoadingBlock, Page, Panel, QueryView, SectionTitle } from "@/components/page";
import { ServiceStatusLine } from "@/components/service-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatLongDay, formatRelativeDay } from "@/lib/format";
import { useSessions, useTodayPlan } from "@/lib/ipc/queries";
import type { Preferences, SessionLength, TodayPlan } from "@/lib/ipc/schemas";
import { RecordingLibrary } from "@/features/practice/RecordingLibrary";
import { loadSequence, startSequence, stepUrl } from "@/features/practice/sequence";
import { StagePanel } from "./StagePanel";
import { WeekRow } from "./WeekRow";
import { EXERCISE_IDS } from "@/content/exercises";
import { SHOW_STYLE_CARD, usePracticeStyle } from "@/features/engagement/style";
import { StyleChoiceCard, shouldOfferStyleChoice } from "@/features/engagement/StyleChoiceCard";
import { prefetchWhenIdle } from "@/app/prefetch";

const LENGTHS: { value: SessionLength; label: string; hint: string }[] = [
  { value: "standard", label: "About 13 minutes", hint: "Four short exercises" },
  { value: "short", label: "About 5 minutes", hint: "One prompt, two takes" },
];

// Loaded in Playful style only, so Calm and start-up never carry the game engine.
const JourneyStrip = lazy(() => import("@/features/journey/JourneyStrip").then((m) => ({ default: m.JourneyStrip })));
// The learning engine (M11) loads after the plan, off the start-up path.
const TodayReanswer = lazy(() => import("@/features/learning/ReanswerCard").then((m) => ({ default: m.TodayReanswer })));
const ProgrammeCard = lazy(() => import("@/features/learning/ProgrammeCard").then((m) => ({ default: m.ProgrammeCard })));

/** The challenge dial (11.2): changes which prompt the plan picks, never your stage. */
const CHALLENGES: { value: Preferences["challengeBias"]; label: string; hint: string }[] = [
  { value: -1, label: "Easier", hint: "Familiar topics with time to prepare." },
  { value: 0, label: "Just right", hint: "The plan as the scheduler chose it." },
  { value: 1, label: "Harder", hint: "Unfamiliar topics first, with half the preparation time." },
];

function ChallengeDial() {
  const qc = useQueryClient();
  const { preferences, update } = usePreferences();
  const current = CHALLENGES.find((c) => c.value === preferences.challengeBias) ?? CHALLENGES[1];
  return (
    <fieldset className="mt-4">
      <legend className="mb-2 text-meta font-medium">Challenge</legend>
      <RadioGroup
        value={String(preferences.challengeBias)}
        onValueChange={(v) => update({ challengeBias: Number(v) as Preferences["challengeBias"] }, { onSettled: () => qc.invalidateQueries({ queryKey: ["today"] }) })}
        className="flex flex-wrap gap-2"
      >
        {CHALLENGES.map((c) => (
          <Label
            key={c.value}
            htmlFor={`challenge-${c.value}`}
            className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary"
          >
            <RadioGroupItem id={`challenge-${c.value}`} value={String(c.value)} />
            {c.label}
          </Label>
        ))}
      </RadioGroup>
      <p className="mt-2 text-meta text-muted-foreground">{current.hint} Your stage only changes when you choose.</p>
    </fieldset>
  );
}

export function TodayPage() {
  const { preferences } = usePreferences();
  const [chosen, setLength] = useState<SessionLength | null>(null);
  // The default length comes from Settings → Practice until you pick one here.
  // After 14 days or more away, today's plan is short unless you choose otherwise (9.13).
  const events = usePracticeEvents();
  const comeback = !!events.data && isComeback(events.data, toLocalDate(new Date()));
  const length = chosen ?? (comeback ? "short" : preferences.sessionLength);
  const plan = useTodayPlan(length);
  // Load the week row's sessions alongside the plan rather than after it.
  useSessions({});
  // The Studio and the likely next pages load in the background once Today is idle (7.1).
  useEffect(() => prefetchWhenIdle(["studio", "done", "sessions", "progress"]), []);

  return (
    <Page>
      <QueryView query={plan} loading={<LoadingBlock rows={4} label="Loading today's plan" />}>
        {(p) => <TodayContent plan={p} length={length} onLengthChange={setLength} />}
      </QueryView>
      {/* Same column and spacing as the plan above, so it reads as the next section, not a wider separate box. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <RecordingLibrary />
      </div>
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
  const { preferences, update } = usePreferences();
  const { playful } = usePracticeStyle();
  const totalMinutes = plan.steps.reduce((n, s) => n + s.minutes, 0);
  const firstRun = !plan.lastCompleted && !plan.resumable;
  // Today's sequence (4.10): start walks the plan step by step; a sequence in progress can be resumed.
  const active = loadSequence(plan.localDate);
  const start = () => {
    const state = startSequence(plan.localDate, length, plan.steps);
    navigate(stepUrl(state.steps[0], state.localDate), { state: { section: "today" } });
  };
  const resume = () => active && navigate(stepUrl(active.steps[active.index], active.localDate), { state: { section: "today" } });

  return (
    <>
      {/* Wide: the week sits beside the title, and the title column takes the width left over
          (basis 0) so status chips that load later wrap inside it. Narrower: one line below. */}
      <header className="mb-8 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        <div className="min-w-0 space-y-2 lg:flex-1">
          <h1 className="text-title font-semibold tracking-tight">{formatLongDay(plan.localDate)}</h1>
          <ServiceStatusLine />
        </div>
        <WeekRow today={plan.localDate} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {firstRun && !preferences.onboarded && (
            <Panel className="flex flex-wrap items-center gap-3" aria-label="First-launch setup">
              <div className="min-w-0 flex-1">
                <p className="font-medium">New here? Set up in four short steps.</p>
                <p className="text-meta text-muted-foreground">Your goal, a microphone check, transcription and feedback choices, and an optional baseline. About three minutes.</p>
              </div>
              <Button asChild><Link to="/welcome">Start setup</Link></Button>
              <Button variant="ghost" onClick={() => update({ onboarded: true })}>Not now</Button>
            </Panel>
          )}
          {shouldOfferStyleChoice(preferences, !!plan.lastCompleted, SHOW_STYLE_CARD) && <StyleChoiceCard />}
          {firstRun ? (
            <EmptyState
              icon={Mic}
              title="Your first session starts here"
              action={
                <Button data-tour="start" size="lg" onClick={start}>
                  Start practice
                </Button>
              }
            >
              Each take is saved as audio on this computer, along with your notes and, if you turn it on, a local
              transcript.
            </EmptyState>
          ) : (
            <Panel data-tour="focus" aria-labelledby="focus-heading" className="p-6 sm:p-8">
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
              <ChallengeDial />

              <div data-tour="start" className="mt-6 flex flex-wrap items-center gap-3">
                {active ? (
                  <>
                    <Button size="lg" onClick={resume}>
                      <RotateCcw aria-hidden /> Resume (step {active.index + 1} of {active.steps.length})
                    </Button>
                    <Button size="lg" variant="outline" onClick={start}>
                      Start fresh
                    </Button>
                  </>
                ) : plan.resumable ? (
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
                <li key={`${i}-${s.exerciseType}`} className="flex items-center gap-4 px-4 py-3">
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
                    to={`/practice/${EXERCISE_IDS.repeat}?prompt=${plan.weekly.newSituation.promptId}${plan.weekly.newSituation.preparationSeconds !== undefined ? `&prepSeconds=${plan.weekly.newSituation.preparationSeconds}` : ""}`}
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
                  {plan.weekly.realConversation.done && <span className="ml-2 text-meta text-muted-foreground">· reflection saved this week</span>}
                  <p>{plan.weekly.realConversation.task}</p>
                  <p className="text-meta text-muted-foreground">
                    Afterwards, note what the listener understood. No recording of anyone else is needed.
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/progress?view=real">{plan.weekly.realConversation.done ? "Add another" : "Add reflection"}</Link>
                </Button>
              </li>
              {!firstRun && (
                <Suspense fallback={null}>
                  <TodayReanswer except={plan.weekly.newSituation.promptId} />
                </Suspense>
              )}
            </ul>
          </section>
        </div>

        <aside className="space-y-6" aria-label="Recent">
          {playful && (
            <Suspense fallback={null}>
              <JourneyStrip />
            </Suspense>
          )}
          <Suspense fallback={null}>
            <ProgrammeCard />
          </Suspense>
          <StagePanel plan={plan} />
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
