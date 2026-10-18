import { rouletteTopics } from "@/lib/content-runtime";
import { useId, useState } from "react";
import { Dices, RotateCw } from "lucide-react";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { drillForType } from "@/content/drills";
import { ROULETTE_CATEGORIES, ROULETTE_TOPICS, type RouletteCategory } from "@/content/roulette-topics";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { DrillModule, DrillParams, DrillPlan } from "../drill-module";
import { at } from "../parts";
import { pick, rng } from "../plan-helpers";
import { Figure, ResultPanel, TakeLink, resultOf, useActivityResult } from "../results";

/**
 * Topic roulette (roadmap 10.3), after Toastmasters' Table Topics: spin for a
 * category and a topic, think for 10 seconds, speak. Timing lights show green
 * at two thirds of the time, amber at eleven twelfths and red at the end; the
 * take stops five seconds after red. One re-spin is allowed.
 */
const drill = drillForType("roulette");
export const SPEAK_CHOICES = [30, 60, 90, 120] as const;
const SPIN_MS = 1600;

export function plan(seed: string, params: DrillParams): DrillPlan {
  const respun = params.respun === true || params.respun === "true";
  const rand = rng(seed, respun ? "respin" : "spin");
  const category = (ROULETTE_CATEGORIES.find((c) => c.id === params.category) ?? pick(rand, ROULETTE_CATEGORIES)).id as RouletteCategory;
  const topic = rouletteTopics(ROULETTE_TOPICS[category], category).find((t) => t.id === params.topic) ?? pick(rand, rouletteTopics(ROULETTE_TOPICS[category], category));
  const speak = SPEAK_CHOICES.find((s) => s === Number(params.speak)) ?? 60;
  return {
    drill, seed, groupId: null, contentId: topic.id,
    params: { category, topic: topic.id, speak, respun },
    sessionPrompt: `Topic roulette: ${topic.text}`,
    rounds: [{ index: 0, key: "round", promptId: topic.id, prompt: topic.text, thinkSeconds: 10, speakSeconds: speak, graceSeconds: 5, lights: true, familiarity: "unfamiliar", hint: `${ROULETTE_CATEGORIES.find((c) => c.id === category)!.label} · think for 10 seconds, then speak.` }],
  };
}

function Setup({ plan: initial, onReady }: Parameters<NonNullable<DrillModule["Setup"]>>[0]) {
  const reduced = useReducedMotion();
  const [current, setCurrent] = useState(initial);
  const [spun, setSpun] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [turns, setTurns] = useState(0);
  const speakId = useId();
  const category = current.params.category as RouletteCategory;
  const index = ROULETTE_CATEGORIES.findIndex((c) => c.id === category);
  const slice = 360 / ROULETTE_CATEGORIES.length;
  const spin = (next: DrillPlan) => {
    setCurrent(next);
    setTurns((t) => t + 1);
    if (reduced) {
      setSpun(true);
      return;
    }
    setSpinning(true);
    window.setTimeout(() => {
      setSpinning(false);
      setSpun(true);
    }, SPIN_MS);
  };
  const nextIndex = ROULETTE_CATEGORIES.findIndex((c) => c.id === current.params.category);
  // Land the chosen category under the pointer at the top, after a few full turns.
  const angle = turns === 0 ? 0 : turns * 3 * 360 - nextIndex * slice - slice / 2;
  return (
    <Panel className="space-y-4">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="relative size-56 shrink-0" aria-hidden>
          <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 border-x-8 border-t-[14px] border-x-transparent border-t-primary" />
          <svg
            viewBox="-100 -100 200 200"
            className="size-56"
            style={{ transform: `rotate(${angle}deg)`, transition: reduced || !spinning ? "none" : `transform ${SPIN_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)` }}
          >
            {ROULETTE_CATEGORIES.map((c, i) => {
              const a0 = ((i * slice - 90) * Math.PI) / 180;
              const a1 = (((i + 1) * slice - 90) * Math.PI) / 180;
              const mid = (((i + 0.5) * slice - 90) * Math.PI) / 180;
              return (
                <g key={c.id}>
                  <path d={`M0 0 L${95 * Math.cos(a0)} ${95 * Math.sin(a0)} A95 95 0 0 1 ${95 * Math.cos(a1)} ${95 * Math.sin(a1)} Z`} fill={i % 2 ? "var(--cp-surface-2)" : "var(--cp-surface)"} stroke="var(--cp-border)" />
                  <text x={62 * Math.cos(mid)} y={62 * Math.sin(mid)} fontSize="9" textAnchor="middle" dominantBaseline="middle" fill="var(--cp-text)">
                    {c.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="min-w-0 flex-1 space-y-3" aria-live="polite">
          {spun && !spinning ? (
            <>
              <p className="text-meta text-muted-foreground">Category: {ROULETTE_CATEGORIES[index].label}</p>
              <p className="text-xl font-semibold text-balance">{current.rounds[0].prompt}</p>
            </>
          ) : (
            <p className="text-muted-foreground">{spinning ? "Spinning…" : "Spin the wheel for a category and a topic."}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {!spun ? (
          <Button onClick={() => spin(initial)} disabled={spinning}>
            <Dices aria-hidden /> Spin
          </Button>
        ) : (
          <>
            <Button onClick={() => onReady(current)} disabled={spinning}>Use this topic</Button>
            {!current.params.respun && (
              <Button variant="outline" disabled={spinning} onClick={() => spin(plan(current.seed, { speak: current.params.speak, respun: true }))}>
                <RotateCw aria-hidden /> Spin again (once)
              </Button>
            )}
          </>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={speakId}>Speaking time</Label>
          <Select value={String(current.params.speak)} onValueChange={(v) => setCurrent(plan(current.seed, { ...current.params, speak: Number(v) }))}>
            <SelectTrigger id={speakId} className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPEAK_CHOICES.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s} seconds
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </Panel>
  );
}

/** Which timing light a take reached, from its length alone. */
export function lightReached(durationMs: number, speakSeconds: number): string {
  const green = (speakSeconds * 1000 * 2) / 3;
  const amber = (speakSeconds * 1000 * 11) / 12;
  if (durationMs >= speakSeconds * 1000) return "You spoke until red, the full time.";
  if (durationMs >= amber) return `You reached amber at ${at(amber)}.`;
  if (durationMs >= green) return `You reached green at ${at(green)}.`;
  return `You stopped at ${at(durationMs)}, before green at ${at(green)}.`;
}

function Result({ plan: p, takes, sessionId }: Parameters<DrillModule["Result"]>[0]) {
  const take = takes.at(-1)!;
  const result = useActivityResult(take.attemptId);
  const basic = resultOf(result.data, "basic");
  const speak = Number(p.params.speak) || 60;
  return (
    <ResultPanel title="Topic roulette" source="measured" label={`${ROULETTE_CATEGORIES.find((c) => c.id === p.params.category)?.label ?? ""} · ${p.rounds[0].prompt}`}>
      <p className="text-xl font-semibold">{lightReached(take.durationMs, speak)}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Figure label="Time spoken" value={at(take.durationMs)} />
        <Figure label="Words (Estimated)" value={basic?.words} />
        <Figure label="Hesitation candidates (Estimated)" value={basic?.hesitations} />
      </div>
      <p className="text-meta text-muted-foreground">
        <TakeLink sessionId={sessionId} ordinal={takes.length}>Listen to the round</TakeLink>
      </p>
    </ResultPanel>
  );
}

const roulette: DrillModule = { plan, Setup, Result, repeatable: true };
export default roulette;
