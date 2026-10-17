import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EvidenceLabel } from "@/components/evidence";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { drillForType } from "@/content/drills";
import { useIpc } from "@/lib/ipc";
import { keys } from "@/lib/ipc/queries";
import type { SelfCheckId } from "@/lib/ipc/schemas";
import type { DrillModule, DrillParams, DrillPlan, DrillRound, PlanContext } from "../drill-module";
import { DrillComparisonPanel } from "../DrillComparison";
import { PromptPicker, at } from "../parts";
import { FALLBACK_PROMPT, hasTag, pick, promptsWhere, rng } from "../plan-helpers";
import { Figure, ResultPanel, TakeLink, resultOf, useActivityResult } from "../results";

/**
 * Explain it three ways (roadmap 10.5): the same explanation for a child, a
 * colleague from another team and an expert. Each round is open: you stop
 * when you're done. Afterwards you choose which version fitted its listener
 * best (Your note).
 */
const drill = drillForType("three_ways");
export const AUDIENCES = [
  { key: "child", label: "A 10-year-old", tip: "Short words and one everyday example.", check: "fit_child" },
  { key: "colleague", label: "A colleague from another team", tip: "Skip the basics; say why it matters to them.", check: "fit_colleague" },
  { key: "expert", label: "An expert", tip: "Be precise and name the trade-offs.", check: "fit_expert" },
] as const satisfies readonly { key: string; label: string; tip: string; check: SelfCheckId }[];
const OWN = "own";

export function plan(seed: string, params: DrillParams, ctx: PlanContext): DrillPlan {
  const explanations = promptsWhere(ctx.prompts, hasTag("explanations"));
  const own = typeof params.topic === "string" && params.topic.trim() ? params.topic.trim().slice(0, 120) : null;
  const prompt = own ? null : (explanations.find((p) => p.id === params.prompt) ?? (explanations.length ? pick(rng(seed, "prompt"), explanations) : null));
  const topic = own ?? prompt?.text ?? FALLBACK_PROMPT;
  const rounds: DrillRound[] = AUDIENCES.map((a, index) => ({
    index, key: a.key, promptId: prompt?.id ?? null, prompt: `Explain it to ${a.label.charAt(0).toLowerCase()}${a.label.slice(1)}`,
    thinkSeconds: index === 0 ? 10 : 5, speakSeconds: null, familiarity: "familiar", audience: a.label,
    hint: a.tip,
    card: (
      <Panel className="space-y-1">
        <p className="text-meta text-muted-foreground">Topic</p>
        <p className="font-medium">{topic}</p>
        <p className="text-meta text-muted-foreground">About a minute is plenty; the time is only a guide.</p>
      </Panel>
    ),
  }));
  return { drill, seed, groupId: null, contentId: prompt?.id ?? null, params: { prompt: prompt?.id ?? OWN }, sessionPrompt: `Explain it three ways: ${topic}`, rounds };
}

function Setup({ plan: initial, ctx, onReady }: Parameters<NonNullable<DrillModule["Setup"]>>[0]) {
  const explanations = promptsWhere(ctx.prompts, hasTag("explanations"));
  const [chosen, setChosen] = useState(String(initial.params.prompt));
  const [own, setOwn] = useState("");
  const ownId = useId();
  return (
    <Panel className="space-y-4">
      <PromptPicker prompts={explanations} value={chosen} onChange={setChosen} label="Something to explain" />
      <div className="space-y-1.5">
        <Label htmlFor={ownId}>Or type your own topic</Label>
        <Input id={ownId} className="h-10" maxLength={120} value={own} placeholder="For example: how a bus timetable works" onChange={(e) => setOwn(e.target.value)} />
      </div>
      <Button onClick={() => onReady(plan(initial.seed, own.trim() ? { topic: own } : { prompt: chosen }, ctx))}>Start</Button>
    </Panel>
  );
}

function Column({ attemptId, label, ordinal, sessionId, durationMs }: { attemptId: string; label: string; ordinal: number; sessionId: string; durationMs: number }) {
  const result = useActivityResult(attemptId);
  const basic = resultOf(result.data, "basic");
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="font-medium">{label}</p>
      <Figure label="Time" value={at(durationMs)} />
      <Figure label="Words (Estimated)" value={basic?.words} />
      <Figure label="Different words in every 50 (Estimated)" value={basic?.differentPer50?.toFixed(0)} />
      <TakeLink sessionId={sessionId} ordinal={ordinal}>Listen</TakeLink>
    </div>
  );
}

/** Which version fitted its listener best: a yes on that take; "about the same" stores nothing. */
function BestFit({ takes }: { takes: { attemptId: string; check: SelfCheckId }[] }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const labelId = useId();
  const [choice, setChoice] = useState("");
  const save = useMutation({
    meta: { engagement: "review" },
    mutationFn: async (key: string) => {
      for (const t of takes) await ipc.setSelfCheck(t.attemptId, t.check, t.check === `fit_${key}` ? true : null);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.facts }),
  });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={labelId}>Which version fitted its listener best?</span>
        <EvidenceLabel source="note" />
      </div>
      <ToggleGroup
        type="single"
        variant="outline"
        aria-labelledby={labelId}
        value={choice}
        onValueChange={(v) => {
          if (!v) return;
          setChoice(v);
          save.mutate(v);
        }}
        className="flex-wrap"
      >
        {AUDIENCES.map((a) => (
          <ToggleGroupItem key={a.key} value={a.key} size="sm" className="h-9 px-3">
            {a.label}
          </ToggleGroupItem>
        ))}
        <ToggleGroupItem value="same" size="sm" className="h-9 px-3">All about the same</ToggleGroupItem>
      </ToggleGroup>
      {save.error && <p role="alert" className="text-meta text-destructive">Your answer couldn't be saved. {save.error.message}</p>}
    </div>
  );
}

function Result({ takes, sessionId }: Parameters<DrillModule["Result"]>[0]) {
  const byRound = AUDIENCES.map((a, i) => ({ a, i, take: [...takes].reverse().find((t) => t.round.index === i) }));
  return (
    <ResultPanel title="Explain it three ways" label="The same topic for three listeners. Compare by listening; the figures only describe each version.">
      <div className="grid gap-3 sm:grid-cols-3">
        {byRound.map(({ a, take }) =>
          take ? <Column key={a.key} attemptId={take.attemptId} label={a.label} ordinal={takes.indexOf(take) + 1} sessionId={sessionId} durationMs={take.durationMs} /> : null,
        )}
      </div>
      <BestFit takes={byRound.flatMap(({ a, take }) => (take ? [{ attemptId: take.attemptId, check: a.check }] : []))} />
      <DrillComparisonPanel sessionId={sessionId} kind="three_ways" labels={AUDIENCES.map((a) => a.label)} />
    </ResultPanel>
  );
}

const threeWays: DrillModule = { plan, Setup, Result };
export default threeWays;
