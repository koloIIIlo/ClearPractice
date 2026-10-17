import { useId, useState } from "react";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { drillForType } from "@/content/drills";
import type { DrillModule, DrillParams, DrillPlan, DrillRound, PlanContext } from "../drill-module";
import { DrillComparisonPanel } from "../DrillComparison";
import { PromptPicker, at } from "../parts";
import { FALLBACK_PROMPT, pick, promptsWhere, rng } from "../plan-helpers";
import { DrillCheck, Figure, ResultPanel, TakeLink, resultOf, useActivityResult } from "../results";

/**
 * Elevator pitch (roadmap 10.9): one idea in 60, then 30, then 15 seconds.
 * Each shorter round asks whether it kept your main point (Your note).
 */
const drill = drillForType("pitch");
export const LENGTHS = [60, 30, 15] as const;

export function plan(seed: string, params: DrillParams, ctx: PlanContext): DrillPlan {
  const candidates = promptsWhere(ctx.prompts, (p) => p.tags.includes("opinions") || p.tags.includes("work") || p.tags.includes("explanations"));
  const own = typeof params.idea === "string" && params.idea.trim() ? params.idea.trim().slice(0, 120) : null;
  const prompt = own ? null : (candidates.find((p) => p.id === params.prompt) ?? (candidates.length ? pick(rng(seed, "prompt"), candidates) : null));
  const idea = own ?? prompt?.text ?? FALLBACK_PROMPT;
  const rounds: DrillRound[] = LENGTHS.map((s, index) => ({
    index, key: `r${s}`, promptId: prompt?.id ?? null, prompt: `Pitch it in ${s} seconds`, thinkSeconds: index === 0 ? 10 : 5, speakSeconds: s, familiarity: "familiar",
    hint: index === 0 ? idea : `Same idea, half the time: keep your main point.`,
  }));
  return { drill, seed, groupId: null, contentId: prompt?.id ?? null, params: { prompt: prompt?.id ?? "own" }, sessionPrompt: `Elevator pitch: ${idea}`, rounds };
}

function Setup({ plan: initial, ctx, onReady }: Parameters<NonNullable<DrillModule["Setup"]>>[0]) {
  const candidates = promptsWhere(ctx.prompts, (p) => p.tags.includes("opinions") || p.tags.includes("work") || p.tags.includes("explanations"));
  const [chosen, setChosen] = useState(String(initial.params.prompt));
  const [own, setOwn] = useState("");
  const ownId = useId();
  return (
    <Panel className="space-y-4">
      <PromptPicker prompts={candidates} value={chosen} onChange={setChosen} label="An idea to pitch" />
      <div className="space-y-1.5">
        <Label htmlFor={ownId}>Or type your own idea</Label>
        <Input id={ownId} className="h-10" maxLength={120} value={own} placeholder="For example: why our team should try shorter meetings" onChange={(e) => setOwn(e.target.value)} />
      </div>
      <Button onClick={() => onReady(plan(initial.seed, own.trim() ? { idea: own } : { prompt: chosen }, ctx))}>Start</Button>
    </Panel>
  );
}

function Round({ attemptId, label, ordinal, sessionId, durationMs, askKept }: { attemptId: string; label: string; ordinal: number; sessionId: string; durationMs: number; askKept: boolean }) {
  const result = useActivityResult(attemptId);
  const basic = resultOf(result.data, "basic");
  return (
    <li className="space-y-2 border-t pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{label}</span>
        <TakeLink sessionId={sessionId} ordinal={ordinal}>Listen</TakeLink>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Figure label="Time" value={at(durationMs)} />
        <Figure label="Words (Estimated)" value={basic?.words} />
      </div>
      {askKept && <DrillCheck attemptId={attemptId} checkId="kept_main_point" question="Did the short version keep your main point?" />}
    </li>
  );
}

function Result({ takes, sessionId }: Parameters<DrillModule["Result"]>[0]) {
  const latest = LENGTHS.map((_, i) => [...takes].reverse().find((t) => t.round.index === i));
  return (
    <ResultPanel title="Elevator pitch" label="The same idea in less and less time.">
      <ol className="space-y-3">
        {LENGTHS.map((s, i) =>
          latest[i] ? (
            <Round key={s} attemptId={latest[i]!.attemptId} label={`${s} seconds`} ordinal={takes.indexOf(latest[i]!) + 1} sessionId={sessionId} durationMs={latest[i]!.durationMs} askKept={i > 0} />
          ) : null,
        )}
      </ol>
      <DrillComparisonPanel sessionId={sessionId} kind="pitch" labels={LENGTHS.map((s) => `${s} seconds`)} />
    </ResultPanel>
  );
}

const pitch: DrillModule = { plan, Setup, Result };
export default pitch;
