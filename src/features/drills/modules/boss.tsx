import { useId, useState } from "react";
import { Link } from "react-router";
import { MessagesSquare } from "lucide-react";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { BOSSES, INTERRUPTIONS, SKEPTICAL_QUESTIONS, bossById, type BossDef } from "@/content/bosses";
import { drillForType } from "@/content/drills";
import { STAR_QUESTIONS } from "@/content/star-questions";
import { areaDef } from "@/lib/engagement/skills";
import { usePracticeStyle } from "@/features/engagement/style";
import type { DrillModule, DrillParams, DrillPlan, DrillRound } from "../drill-module";
import { at } from "../parts";
import { rng, sample } from "../plan-helpers";
import { DrillCheck, ResultPanel, TakeLink, resultOf, useActivityResult } from "../results";

/**
 * Boss levels (roadmap 10.13): bigger challenges with written questions, fully
 * offline. Each ends with a question you answer yourself (Your note); how calm
 * you felt is your own reading, never measured.
 */
const drill = drillForType("boss");
const POOLS = { star: STAR_QUESTIONS, skeptical: SKEPTICAL_QUESTIONS, interruption: INTERRUPTIONS } as const;

function Cards({ cards }: { cards: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Structure">
      {cards.map((c, i) => (
        <li key={c} className="rounded-lg border bg-card px-3 py-1.5 text-meta">
          {i + 1}. {c}
        </li>
      ))}
    </ul>
  );
}

export function plan(seed: string, params: DrillParams): DrillPlan {
  const boss: BossDef = bossById(String(params.boss)) ?? BOSSES[0];
  const rounds: DrillRound[] = [];
  const questionIds: string[] = [];
  for (const r of boss.rounds) {
    if (r.kind === "fixed") {
      // An interrupted round stops at the interruption; the next round answers it.
      const stopsAt = r.interruptAtSeconds ?? r.speakSeconds;
      rounds.push({
        index: rounds.length, key: r.key, promptId: null, prompt: r.prompt, thinkSeconds: r.thinkSeconds, speakSeconds: stopsAt, familiarity: "unfamiliar",
        hint: r.interruptAtSeconds ? "Someone may interrupt before the minute is up." : undefined,
        card: r.cards ? <Cards cards={r.cards} /> : undefined,
      });
    } else {
      for (const q of sample(rng(seed, `${boss.id}:${r.key}`), POOLS[r.from], r.count)) {
        questionIds.push(q.id);
        rounds.push({
          index: rounds.length, key: `${r.key}-${rounds.length}`.slice(0, 40), promptId: q.id, prompt: q.text, thinkSeconds: r.thinkSeconds, speakSeconds: r.speakSeconds, familiarity: "unfamiliar",
          followUp: r.from !== "star",
          hint: r.from === "interruption" ? "Answer the question, then get back to your point." : undefined,
          card: r.cards ? <Cards cards={r.cards} /> : undefined,
        });
      }
    }
  }
  return { drill, seed, groupId: null, contentId: null, params: { boss: boss.id, questions: questionIds }, sessionPrompt: `Boss: ${boss.title}`, rounds };
}

function Setup({ plan: initial, onReady }: Parameters<NonNullable<DrillModule["Setup"]>>[0]) {
  const { playful } = usePracticeStyle();
  const [chosen, setChosen] = useState(String(initial.params.boss));
  const labelId = useId();
  return (
    <Panel className="space-y-4">
      <p id={labelId} className="font-medium">Choose a boss</p>
      <RadioGroup aria-labelledby={labelId} value={chosen} onValueChange={setChosen} className="grid gap-2 sm:grid-cols-2">
        {BOSSES.map((b) => (
          <Label key={b.id} htmlFor={`boss-${b.id}`} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary">
            <RadioGroupItem id={`boss-${b.id}`} value={b.id} aria-labelledby={`boss-${b.id}-title`} className="mt-1" />
            <span className="min-w-0 space-y-1">
              <span id={`boss-${b.id}-title`} className="block font-medium">{b.title}</span>
              <span className="block text-meta text-muted-foreground">{b.description}</span>
              {playful && <span className="block text-meta text-muted-foreground">Recommended after {areaDef(b.recommendedAfter.area).title} {b.recommendedAfter.level}</span>}
            </span>
          </Label>
        ))}
      </RadioGroup>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => onReady(plan(initial.seed, { boss: chosen }))}>Start</Button>
        {/* Boss levels v2 (13.6): the partner plays the other person; either version finishes the boss. */}
        <Button variant="outline" asChild>
          <Link to={`/partner?boss=${chosen}`}>
            <MessagesSquare aria-hidden /> Play with the partner
          </Link>
        </Button>
      </div>
    </Panel>
  );
}

function RoundRow({ attemptId, round, ordinal, sessionId, durationMs }: { attemptId: string; round: DrillRound; ordinal: number; sessionId: string; durationMs: number }) {
  const result = useActivityResult(attemptId);
  const basic = resultOf(result.data, "basic");
  return (
    <li className="space-y-0.5 border-t pt-2 first:border-t-0 first:pt-0">
      <p>{round.prompt}</p>
      <p className="text-meta text-muted-foreground">
        {at(durationMs)}
        {basic?.words != null && ` · ${basic.words} words (Estimated)`} · <TakeLink sessionId={sessionId} ordinal={ordinal}>Listen</TakeLink>
      </p>
    </li>
  );
}

function Result({ plan: p, takes, sessionId }: Parameters<DrillModule["Result"]>[0]) {
  const boss = bossById(String(p.params.boss)) ?? BOSSES[0];
  const last = takes.at(-1);
  return (
    <ResultPanel title={boss.title} source="measured" label="Time spoken per round; the closing question is yours to answer.">
      <ol className="space-y-2">
        {takes.map((t, i) => (
          <RoundRow key={t.attemptId} attemptId={t.attemptId} round={t.round} ordinal={i + 1} sessionId={sessionId} durationMs={t.durationMs} />
        ))}
      </ol>
      {last && <DrillCheck attemptId={last.attemptId} checkId="final_check" question={boss.finalCheck} />}
    </ResultPanel>
  );
}

const boss: DrillModule = { plan, Setup, Result };
export default boss;
