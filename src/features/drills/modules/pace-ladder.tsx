import { useQueries } from "@tanstack/react-query";
import { drillForType } from "@/content/drills";
import { useIpc } from "@/lib/ipc";
import { keys } from "@/lib/ipc/queries";
import { ladder } from "@/lib/engagement/drills";
import type { DrillModule, DrillParams, DrillPlan, DrillRound, PlanContext } from "../drill-module";
import { FALLBACK_PROMPT, pick, promptsWhere, rng } from "../plan-helpers";
import { Figure, ResultPanel, TakeLink } from "../results";

/**
 * Pace ladder (roadmap 10.7): the same short answer slowly, naturally, then
 * quickly, with the live pace meter on. It trains range and control; no
 * speed is called better than another (D-34).
 */
const drill = drillForType("pace_ladder");
export const STEPS = [
  { key: "slow", label: "Slowly", hint: "Take your time between words and phrases." },
  { key: "natural", label: "At your natural speed", hint: "As you would talk to a friend." },
  { key: "fast", label: "Quickly", hint: "Faster than usual, but every word still clear." },
] as const;

export function plan(seed: string, params: DrillParams, ctx: PlanContext): DrillPlan {
  const familiar = promptsWhere(ctx.prompts, (p) => p.conditions.familiarity === "familiar");
  const prompt = familiar.find((p) => p.id === params.prompt) ?? (familiar.length ? pick(rng(seed, "prompt"), familiar) : null);
  const text = prompt?.text ?? FALLBACK_PROMPT;
  const rounds: DrillRound[] = STEPS.map((s, index) => ({
    index, key: s.key, promptId: prompt?.id ?? null, prompt: `${s.label}: ${text}`, thinkSeconds: index === 0 ? 5 : 3, speakSeconds: 30, familiarity: "familiar", hint: s.hint,
  }));
  return { drill, seed, groupId: null, contentId: prompt?.id ?? null, params: { prompt: prompt?.id ?? "fallback" }, sessionPrompt: `Pace ladder: ${text}`, rounds };
}

function Result({ takes, sessionId }: Parameters<DrillModule["Result"]>[0]) {
  const ipc = useIpc();
  const latest = STEPS.map((_, i) => [...takes].reverse().find((t) => t.round.index === i));
  const results = useQueries({
    queries: latest.map((t) => ({ queryKey: keys.activityResult(t?.attemptId ?? ""), queryFn: () => ipc.getActivityResult(t!.attemptId), enabled: !!t, retry: false })),
  });
  const rates = results.map((r) => (r.data?.kind === "pace_ladder" ? r.data.rateSps : null));
  const { range, distinct } = ladder(rates);
  return (
    <ResultPanel title="Pace ladder" label="Speech rate from the audio, in syllables a second.">
      <p className="text-xl font-semibold">
        {range === null ? "The range needs a rate from all three rounds" : distinct ? `Three clearly different speeds · range ${range.toFixed(1)}` : `Range ${range.toFixed(1)} · try making the steps further apart`}
      </p>
      <div className="grid grid-cols-3 gap-3">
        {STEPS.map((s, i) => (
          <div key={s.key} className="space-y-1">
            <Figure label={s.label} value={rates[i]?.toFixed(1)} unit="syllables/s" />
            {latest[i] && <TakeLink sessionId={sessionId} ordinal={takes.indexOf(latest[i]!) + 1}>Listen</TakeLink>}
            {results[i].data?.kind === "pace_ladder" && results[i].data.unavailableReason && <p className="text-meta text-muted-foreground">{results[i].data.unavailableReason}</p>}
          </div>
        ))}
      </div>
      <p className="text-muted-foreground">Range, not speed: being able to slow down on purpose is the skill.</p>
    </ResultPanel>
  );
}

const paceLadder: DrillModule = { plan, Result };
export default paceLadder;
