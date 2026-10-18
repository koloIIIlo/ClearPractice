import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { History, Info } from "lucide-react";
import { EvidenceLabel } from "@/components/evidence";
import { EmptyState, LoadingBlock, Page, PageHeader, Panel, SectionTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BASELINE_PROMPT } from "@/content/prompts";
import { useAutoTranscribe } from "@/features/practice/auto-transcribe";
import { useRecorder } from "@/features/practice/recorder";
import { RecorderPanel, useRecorderGuard } from "@/features/practice/RecorderPanel";
import { capsuleMonths, capsulePrompt } from "@/lib/capsule";
import { formatClock, formatDay, parseLocalDate, UI_LOCALE } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import type { PracticeContext } from "@/lib/ipc/client";
import { usePracticeFacts, usePreferences, usePrompts } from "@/lib/ipc/queries";
import type { FactTake, PracticeFacts } from "@/lib/ipc/schemas";

/** The exercise of every time-capsule session (14.5). */
export const CAPSULE_EXERCISE = "ex-capsule";

const monthFmt = new Intl.DateTimeFormat(UI_LOCALE, { month: "short", year: "numeric" });
export const monthLabel = (month: string) => monthFmt.format(parseLocalDate(`${month}-01`));

const compareHref = (a: string, b: string) => `/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;

/** Then and now, side by side: the same measures, no colours and no judgement (14.5). */
export function ThenNow({ then, now }: { then: FactTake; now: FactTake }) {
  const rows: { label: string; source: "measured" | "estimated"; value: (t: FactTake) => string }[] = [
    { label: "Length", source: "measured", value: (t) => formatClock(t.durationMs) },
    { label: "Words", source: "estimated", value: (t) => (t.words ?? "–").toString() },
    { label: "Pace", source: "estimated", value: (t) => (t.paceWpm !== null ? `${Math.round(t.paceWpm)} wpm` : "–") },
    { label: "Hesitation candidates", source: "estimated", value: (t) => (t.fillerCandidates ?? "–").toString() },
  ];
  return (
    <div className="space-y-2">
      <table className="w-full max-w-xl text-left tabular-nums">
        <caption className="sr-only">Your first answer and your latest, side by side</caption>
        <thead className="text-meta text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="py-2 pr-3 font-medium">Measure</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Then, {formatDay(then.localDate)}</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Now, {formatDay(now.localDate)}</th>
            <th scope="col" className="py-2 font-medium"><span className="sr-only">Source</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b">
              <th scope="row" className="py-2 pr-3 font-normal">{r.label}</th>
              <td className="py-2 pr-3 text-right">{r.value(then)}</td>
              <td className="py-2 pr-3 text-right">{r.value(now)}</td>
              <td className="py-2 pl-2"><EvidenceLabel source={r.source} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {(now.words === null || then.words === null) && <p className="text-meta text-muted-foreground">Words, pace and hesitation candidates show once both takes are transcribed.</p>}
    </div>
  );
}

/** Your capsules, one chip a month: choose two to listen to side by side (14.5). */
export function CapsuleChips({ facts }: { facts: PracticeFacts }) {
  const navigate = useNavigate();
  const months = capsuleMonths(facts);
  const [chosen, setChosen] = useState<string[]>([]);
  if (months.length === 0) return null;
  const pick = (value: string[]) => {
    if (value.length === 2) {
      const [a, b] = value.map((m) => months.find((c) => c.month === m)!.take).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
      navigate(compareHref(a.id, b.id));
    }
    setChosen(value.slice(-2));
  };
  return (
    <div className="space-y-2">
      <ToggleGroup type="multiple" variant="outline" aria-label="Your capsules" className="flex-wrap justify-start" value={chosen} onValueChange={pick}>
        {months.map((c) => <ToggleGroupItem key={c.month} value={c.month} className="h-9 px-3">{monthLabel(c.month)}</ToggleGroupItem>)}
      </ToggleGroup>
      <p className="text-meta text-muted-foreground">{months.length === 1 ? "Your first capsule. Next month's joins it here." : "Choose two months to listen to them side by side."}</p>
    </div>
  );
}

function CapsuleRecorder({ prompt, first }: { prompt: { promptId: string; text: string }; first: FactTake | null }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const { preferences } = usePreferences();
  const prompts = usePrompts();
  const facts = usePracticeFacts();
  const native = ipc.recordingMode === "native";
  const [sessionId] = useState(() => crypto.randomUUID());
  const conditions = (prompt.promptId === BASELINE_PROMPT.id ? BASELINE_PROMPT : prompts.data?.find((p) => p.id === prompt.promptId))?.conditions ?? BASELINE_PROMPT.conditions;
  const context: PracticeContext = {
    sessionId,
    exerciseId: CAPSULE_EXERCISE,
    exerciseVersion: 1,
    exerciseType: "capsule",
    prompt: prompt.text,
    outline: { point: "", reason: "", example: "" },
    conditions: { ...conditions, audience: conditions.audience ?? null, followUp: false },
    contentId: prompt.promptId,
  };
  const rec = useRecorder("Time capsule", context);
  const guard = useRecorderGuard(rec);
  useAutoTranscribe(rec.takes.map((t) => t.asset.assetId), sessionId, { enabled: preferences.autoTranscribe });
  const seen = useRef(rec.takes.length);
  useEffect(() => {
    if (rec.takes.length <= seen.current) return;
    seen.current = rec.takes.length;
    void qc.invalidateQueries({ queryKey: ["engagement"] });
  }, [rec.takes.length]);
  const latest = rec.takes.at(-1);
  const now = latest && facts.data?.takes.find((t) => t.id === latest.asset.attemptId);
  return (
    <div className="space-y-6">
      <Panel>
        <p className="text-meta text-muted-foreground">Your first question{first ? `, first answered ${formatDay(first.localDate)}` : ""}</p>
        <p className="mt-1 text-xl font-semibold tracking-tight text-balance">{prompt.text}</p>
        <p className="mt-2 text-meta text-muted-foreground">Answer it as you would today. There's no need to remember what you said then. About 2 minutes.</p>
      </Panel>
      {!native && (
        <p role="note" className="flex items-center gap-2 text-meta text-muted-foreground">
          <Info aria-hidden className="size-4 shrink-0" /> Browser preview: recording is simulated.
        </p>
      )}
      <RecorderPanel rec={rec} />
      {latest && first && (
        <Panel aria-labelledby="capsule-compare">
          <SectionTitle id="capsule-compare">Then and now</SectionTitle>
          <div className="mb-4 flex flex-wrap gap-2">
            <Button asChild><Link to={compareHref(first.id, latest.asset.attemptId)}><History aria-hidden /> Compare with your first</Link></Button>
            <Button variant="outline" asChild><Link to={`/sessions/${sessionId}`}>Open the session</Link></Button>
          </div>
          {now ? <ThenNow then={first} now={now} /> : <LoadingBlock rows={1} label="Loading the measures" />}
        </Panel>
      )}
      {guard}
    </div>
  );
}

/**
 * The voice time capsule (roadmap 14.5): once a month, answer the same question
 * as your first recording, then listen to the first and the latest side by
 * side. Measures sit next to each other with no colours and no judgement.
 */
export function TimeCapsulePage() {
  const facts = usePracticeFacts();
  const prompts = usePrompts();
  const capsule = useMemo(() => (facts.data && prompts.data ? capsulePrompt(facts.data, prompts.data) : null), [facts.data, prompts.data]);
  return (
    <Page className="max-w-4xl">
      <PageHeader title="Time capsule" description="You versus you: once a month, answer your first question again, then listen to the first and the latest side by side." />
      {facts.isPending || prompts.isPending ? (
        <LoadingBlock rows={3} label="Loading your first question" />
      ) : !capsule ? (
        <EmptyState icon={History} title="Your capsule needs a first answer" action={<Button asChild><Link to="/">Go to Today</Link></Button>}>
          Answer a prompt first. Your baseline, or the first prompt you answer, becomes the capsule's question.
        </EmptyState>
      ) : (
        <div className="space-y-8">
          <CapsuleRecorder prompt={capsule} first={capsule.firstTake} />
          {facts.data && capsuleMonths(facts.data).length > 0 && (
            <section aria-labelledby="capsule-months">
              <SectionTitle id="capsule-months">Your capsules</SectionTitle>
              <CapsuleChips facts={facts.data} />
            </section>
          )}
        </div>
      )}
    </Page>
  );
}
