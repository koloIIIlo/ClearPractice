import { useId, useState } from "react";
import { Dices, RotateCw } from "lucide-react";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { drillForType } from "@/content/drills";
import { STORY_ICONS, type StoryIcon } from "@/content/story";
import type { DrillModule, DrillParams, DrillPlan } from "../drill-module";
import { at } from "../parts";
import { rng, sample } from "../plan-helpers";
import { DrillCheck, Figure, NeedsTranscript, ResultPanel, TakeLink, resultOf, useActivityResult } from "../results";

/**
 * Story cubes (roadmap 10.8): roll three to six picture cubes, think for 15
 * seconds, then tell a story that uses them all. The native result matches
 * each picture's words in the transcript, once per cube.
 */
const drill = drillForType("story_cubes");
export const CUBE_COUNTS = [3, 4, 5, 6] as const;

export function plan(seed: string, params: DrillParams): DrillPlan {
  const count = CUBE_COUNTS.find((c) => c === Number(params.cubes)) ?? 4;
  const rerolled = params.rerolled === true || params.rerolled === "true";
  const icons = sample(rng(seed, rerolled ? "reroll" : "roll"), STORY_ICONS, count);
  return {
    drill, seed, groupId: null, contentId: null,
    params: { cubes: count, rerolled, iconIds: icons.map((i) => i.id), icons: icons.map((i) => i.synonyms.join("|")) },
    sessionPrompt: `Story cubes: ${icons.map((i) => i.label).join(", ")}`,
    rounds: [{ index: 0, key: "round", promptId: null, prompt: "Tell a story that uses every picture", thinkSeconds: 15, speakSeconds: 90, familiarity: "unfamiliar", hint: icons.map((i) => i.label).join(" · ") }],
  };
}

const iconsOf = (p: DrillPlan): StoryIcon[] => (p.params.iconIds as string[]).flatMap((id) => STORY_ICONS.filter((i) => i.id === id));

function Cubes({ icons, used }: { icons: StoryIcon[]; used?: readonly number[] | null }) {
  return (
    <ul className="flex flex-wrap justify-center gap-3">
      {icons.map((icon, i) => {
        const Icon = icon.icon;
        return (
          <li key={icon.id} className="flex w-20 flex-col items-center gap-1 rounded-lg border bg-card p-2 text-center" data-used={used ? used[i] === 1 : undefined}>
            <Icon aria-hidden className="size-8" />
            <span className="text-meta">{icon.label}</span>
            {used && <span className="text-meta text-muted-foreground">{used[i] === 1 ? "used" : "not found"}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function Setup({ plan: initial, onReady }: Parameters<NonNullable<DrillModule["Setup"]>>[0]) {
  const [current, setCurrent] = useState(initial);
  const [rolled, setRolled] = useState(false);
  const countId = useId();
  return (
    <Panel className="space-y-4">
      {rolled ? <Cubes icons={iconsOf(current)} /> : <p className="text-muted-foreground">Roll the cubes to get your pictures.</p>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={countId}>Cubes</Label>
          <Select value={String(current.params.cubes)} disabled={rolled} onValueChange={(v) => setCurrent(plan(current.seed, { cubes: Number(v) }))}>
            <SelectTrigger id={countId} className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CUBE_COUNTS.map((c) => (
                <SelectItem key={c} value={String(c)}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!rolled ? (
          <Button onClick={() => setRolled(true)}>
            <Dices aria-hidden /> Roll
          </Button>
        ) : (
          <>
            <Button onClick={() => onReady(current)}>Use these pictures</Button>
            {!current.params.rerolled && (
              <Button variant="outline" onClick={() => setCurrent(plan(current.seed, { cubes: current.params.cubes, rerolled: true }))}>
                <RotateCw aria-hidden /> Roll again (once)
              </Button>
            )}
          </>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {rolled ? `Your pictures: ${iconsOf(current).map((i) => i.label).join(", ")}.` : ""}
      </p>
    </Panel>
  );
}

function Live({ plan: p }: Parameters<NonNullable<DrillModule["Live"]>>[0]) {
  return <Cubes icons={iconsOf(p)} />;
}

function Result({ plan: p, takes, sessionId }: Parameters<DrillModule["Result"]>[0]) {
  const take = takes.at(-1)!;
  const result = useActivityResult(take.attemptId);
  const cubes = resultOf(result.data, "story_cubes");
  const icons = iconsOf(p);
  return (
    <ResultPanel title="Story cubes" label="Pictures you mentioned, found in the transcript.">
      <p className="text-xl font-semibold">{cubes?.used == null ? `${icons.length} pictures` : `Pictures used: ${cubes.used} of ${cubes.icons}`}</p>
      <Cubes icons={icons} used={cubes?.usedIcons} />
      <NeedsTranscript reason={cubes?.unavailableReason} />
      <div className="grid grid-cols-2 gap-3">
        <Figure label="Time" value={at(take.durationMs)} />
      </div>
      <DrillCheck attemptId={take.attemptId} checkId="used_all_icons" question="Did your story use every picture?" />
      <TakeLink sessionId={sessionId} ordinal={takes.length}>Listen to your story</TakeLink>
    </ResultPanel>
  );
}

const storyCubes: DrillModule = { plan, Setup, Live, Result, repeatable: true };
export default storyCubes;
