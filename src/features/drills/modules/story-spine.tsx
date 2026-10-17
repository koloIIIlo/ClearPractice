import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { drillForType } from "@/content/drills";
import { SPINE_CARDS, STORY_SEEDS } from "@/content/story";
import type { DrillModule, DrillParams, DrillPlan } from "../drill-module";
import { at } from "../parts";
import { pick, rng } from "../plan-helpers";
import { DrillCheck, Figure, ResultPanel, TakeLink, resultOf, useActivityResult } from "../results";

/**
 * Story spine (roadmap 10.8, Kenn Adams): a 90-second story told one card at
 * a time. The right arrow key or Next card moves on and leaves a mark, so the
 * result can say how far the story got.
 */
const drill = drillForType("story_spine");

export function plan(seed: string, params: DrillParams): DrillPlan {
  const story = STORY_SEEDS.find((s) => s.id === params.seed) ?? pick(rng(seed, "seed"), STORY_SEEDS);
  return {
    drill, seed, groupId: null, contentId: story.id,
    params: { seed: story.id },
    sessionPrompt: `Story spine: ${story.text}`,
    rounds: [{ index: 0, key: "round", promptId: story.id, prompt: story.text, thinkSeconds: 10, speakSeconds: 90, familiarity: "familiar", hint: "Follow the cards from Once upon a time to Ever since then." }],
  };
}

function Live({ speaking, mark }: Parameters<NonNullable<DrillModule["Live"]>>[0]) {
  const [step, setStep] = useState(0);
  const last = SPINE_CARDS.length - 1;
  const advance = () => {
    if (!speaking || step >= last) return;
    mark({ kind: "card_advanced", data: { step: step + 1 } });
    setStep((s) => s + 1);
  };
  useEffect(() => {
    if (speaking) setStep(0);
  }, [speaking]);
  useEffect(() => {
    if (!speaking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [role=slider], [contenteditable=true]")) return;
      e.preventDefault();
      advance();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div className="flex w-full flex-col items-center gap-2 text-center">
      <p aria-live="polite" className="text-2xl font-semibold">{SPINE_CARDS[step]}</p>
      {step < last && <p className="text-meta text-muted-foreground">Next: {SPINE_CARDS[step + 1]}</p>}
      <Button variant="outline" size="sm" disabled={!speaking || step >= last} onClick={advance} aria-keyshortcuts="ArrowRight">
        Next card <ArrowRight aria-hidden />
      </Button>
    </div>
  );
}

function Result({ plan: p, takes, sessionId }: Parameters<DrillModule["Result"]>[0]) {
  const take = takes.at(-1)!;
  const result = useActivityResult(take.attemptId);
  const spine = resultOf(result.data, "story_spine");
  return (
    <ResultPanel title="Story spine" source="note" label={p.rounds[0].prompt}>
      <p className="text-xl font-semibold">{spine ? `Spine steps reached: ${spine.steps} of ${SPINE_CARDS.length}` : "Working out the result…"}</p>
      <p className="text-meta text-muted-foreground">Counted from the cards you moved on to.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Figure label="Time" value={at(take.durationMs)} />
        <Figure label="Words (Estimated)" value={spine?.words} />
      </div>
      <DrillCheck attemptId={take.attemptId} checkId="concrete_detail" question="Did your story have one concrete detail, such as a name, a place or a sound?" />
      <TakeLink sessionId={sessionId} ordinal={takes.length}>Listen to your story</TakeLink>
    </ResultPanel>
  );
}

const storySpine: DrillModule = { plan, Live, Result, repeatable: true };
export default storySpine;
