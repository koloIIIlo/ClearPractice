import { useId, useState } from "react";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { drillForType } from "@/content/drills";
import { followUpsFor } from "@/content/followups";
import type { DrillModule, DrillParams, DrillPlan, PlanContext } from "../drill-module";
import { PromptPicker, at } from "../parts";
import { FALLBACK_PROMPT, hasTag, pick, promptsWhere, rng } from "../plan-helpers";
import { DrillCheck, Figure, ResultPanel, TakeLink, resultOf, useActivityResult } from "../results";

/**
 * Steelman (roadmap 10.10): say where you stand, then argue the other side as
 * well as you can for 90 seconds, then answer its strongest objection in 60.
 * Whether you put it fairly is your own judgement (Your note).
 */
const drill = drillForType("steelman");
type Side = "for" | "against";
const GENERAL_OBJECTION = "What is the strongest objection to the side you just argued? Answer it.";

export function plan(seed: string, params: DrillParams, ctx: PlanContext): DrillPlan {
  const opinions = promptsWhere(ctx.prompts, hasTag("opinions"));
  const prompt = opinions.find((p) => p.id === params.prompt) ?? (opinions.length ? pick(rng(seed, "prompt"), opinions) : null);
  const text = prompt?.text ?? FALLBACK_PROMPT;
  const stand = params.stand === "for" || params.stand === "against" || params.stand === "unsure" ? params.stand : "unsure";
  const argue: Side = stand === "for" ? "against" : stand === "against" ? "for" : params.argue === "for" ? "for" : "against";
  const objection = prompt ? pick(rng(seed, "objection"), followUpsFor(prompt.id)) : GENERAL_OBJECTION;
  return {
    drill, seed, groupId: null, contentId: prompt?.id ?? null,
    params: { prompt: prompt?.id ?? "fallback", stand, argue },
    sessionPrompt: `Steelman: ${text}`,
    rounds: [
      { index: 0, key: "argue", promptId: prompt?.id ?? null, prompt: `Argue ${argue}: ${text}`, thinkSeconds: 15, speakSeconds: 90, familiarity: "unfamiliar", hint: "Make the best case someone on that side would make." },
      { index: 1, key: "objection", promptId: prompt?.id ?? null, prompt: objection, thinkSeconds: 10, speakSeconds: 60, familiarity: "unfamiliar", followUp: true, hint: "Answer it as someone on that side would." },
    ],
  };
}

function Setup({ plan: initial, ctx, onReady }: Parameters<NonNullable<DrillModule["Setup"]>>[0]) {
  const opinions = promptsWhere(ctx.prompts, hasTag("opinions"));
  const [chosen, setChosen] = useState(String(initial.params.prompt));
  const [stand, setStand] = useState<"" | "for" | "against" | "unsure">("");
  const [argue, setArgue] = useState<"" | Side>("");
  const standId = useId();
  const argueId = useId();
  const canStart = stand === "for" || stand === "against" || (stand === "unsure" && argue !== "");
  return (
    <Panel className="space-y-4">
      <PromptPicker prompts={opinions} value={chosen} onChange={setChosen} label="An opinion question" />
      <div className="space-y-1.5">
        <p id={standId} className="font-medium">Where do you stand?</p>
        <ToggleGroup type="single" variant="outline" aria-labelledby={standId} value={stand} onValueChange={(v) => setStand(v as typeof stand)}>
          <ToggleGroupItem value="for" size="sm" className="h-9 px-3">For</ToggleGroupItem>
          <ToggleGroupItem value="against" size="sm" className="h-9 px-3">Against</ToggleGroupItem>
          <ToggleGroupItem value="unsure" size="sm" className="h-9 px-3">Not sure</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {stand === "unsure" && (
        <div className="space-y-1.5">
          <p id={argueId} className="font-medium">Then choose the side to argue</p>
          <ToggleGroup type="single" variant="outline" aria-labelledby={argueId} value={argue} onValueChange={(v) => setArgue(v as typeof argue)}>
            <ToggleGroupItem value="for" size="sm" className="h-9 px-3">For</ToggleGroupItem>
            <ToggleGroupItem value="against" size="sm" className="h-9 px-3">Against</ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}
      {(stand === "for" || stand === "against") && <p className="text-muted-foreground">You'll argue {stand === "for" ? "against" : "for"}: the side you didn't choose.</p>}
      <Button disabled={!canStart} onClick={() => onReady(plan(initial.seed, { prompt: chosen, stand: stand || "unsure", argue: argue || "against" }, ctx))}>
        Start
      </Button>
    </Panel>
  );
}

function Result({ takes, sessionId }: Parameters<DrillModule["Result"]>[0]) {
  const argued = [...takes].reverse().find((t) => t.round.index === 0);
  const answered = [...takes].reverse().find((t) => t.round.index === 1);
  const a = useActivityResult(argued?.attemptId);
  const b = useActivityResult(answered?.attemptId);
  return (
    <ResultPanel title="Steelman" label="Your case for the other side, and your answer to its strongest objection.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Case, time" value={argued ? at(argued.durationMs) : null} />
        <Figure label="Case, words (Estimated)" value={resultOf(a.data, "basic")?.words} />
        <Figure label="Answer, time" value={answered ? at(answered.durationMs) : null} />
        <Figure label="Answer, words (Estimated)" value={resultOf(b.data, "basic")?.words} />
      </div>
      {argued && <DrillCheck attemptId={argued.attemptId} checkId="fair_other_side" question="Would someone on that side say you put it fairly?" />}
      {argued && <TakeLink sessionId={sessionId} ordinal={takes.indexOf(argued) + 1}>Listen to your case</TakeLink>}
    </ResultPanel>
  );
}

const steelman: DrillModule = { plan, Setup, Result };
export default steelman;
