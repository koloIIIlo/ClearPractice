import { drillForType } from "@/content/drills";
import { followUpsFor } from "@/content/followups";
import type { DrillModule, DrillParams, DrillPlan, DrillRound, PlanContext } from "../drill-module";
import { at } from "../parts";
import { FALLBACK_PROMPT, hasTag, pick, promptsWhere, rng } from "../plan-helpers";
import { ResultPanel, TakeLink, resultOf, useActivityResult } from "../results";

/**
 * Gauntlet (roadmap 10.12): five rounds back to back, each a little harder,
 * from a familiar question to arguing the other side. A round counts when
 * you speak for 10 seconds or more.
 */
const drill = drillForType("gauntlet");
export const ROUND_MIN_MS = 10_000;

export function plan(seed: string, _params: DrillParams, ctx: PlanContext): DrillPlan {
  const rand = rng(seed, "rounds");
  const choose = (match: Parameters<typeof promptsWhere>[1]) => {
    const list = promptsWhere(ctx.prompts, match);
    return list.length ? pick(rand, list) : null;
  };
  const familiar = choose((p) => p.conditions.familiarity === "familiar");
  const unfamiliar = choose((p) => p.conditions.familiarity === "unfamiliar" && p.id !== familiar?.id);
  const listener = choose((p) => !!p.conditions.audience && p.id !== familiar?.id && p.id !== unfamiliar?.id);
  const opinion = choose(hasTag("opinions"));
  const followUp = listener ? pick(rand, followUpsFor(listener.id)) : "What would you add if you had another minute?";
  const text = (p: { text: string } | null) => p?.text ?? FALLBACK_PROMPT;
  const rounds: DrillRound[] = [
    { index: 0, key: "familiar", promptId: familiar?.id ?? null, prompt: text(familiar), thinkSeconds: 10, speakSeconds: 30, familiarity: "familiar", hint: "Round 1: a familiar question, 30 seconds." },
    { index: 1, key: "unfamiliar", promptId: unfamiliar?.id ?? null, prompt: text(unfamiliar), thinkSeconds: 10, speakSeconds: 45, familiarity: "unfamiliar", hint: "Round 2: something new, 45 seconds." },
    { index: 2, key: "listener", promptId: listener?.id ?? null, prompt: text(listener), thinkSeconds: 10, speakSeconds: 60, familiarity: "unfamiliar", audience: listener?.conditions.audience ?? "Someone new to the topic", hint: `Round 3: for ${listener?.conditions.audience ?? "someone new to the topic"}, 60 seconds.` },
    { index: 3, key: "follow-up", promptId: listener?.id ?? null, prompt: followUp, thinkSeconds: 5, speakSeconds: 45, familiarity: "unfamiliar", followUp: true, hint: "Round 4: a follow-up about round 3, 45 seconds." },
    { index: 4, key: "steelman", promptId: opinion?.id ?? null, prompt: `Argue the side you disagree with: ${text(opinion)}`, thinkSeconds: 10, speakSeconds: 60, familiarity: "unfamiliar", hint: "Round 5: the other side, 60 seconds." },
  ];
  return {
    drill, seed, groupId: null, contentId: null,
    params: { prompts: [familiar, unfamiliar, listener, opinion].map((p) => p?.id ?? "fallback") },
    sessionPrompt: "Gauntlet · 5 rounds",
    rounds,
  };
}

function Chip({ attemptId, label, durationMs, ordinal, sessionId }: { attemptId: string; label: string; durationMs: number; ordinal: number; sessionId: string }) {
  const result = useActivityResult(attemptId);
  const basic = resultOf(result.data, "basic");
  return (
    <li className="rounded-lg border px-3 py-2">
      <p className="font-medium">{label}</p>
      <p className="text-meta text-muted-foreground">
        {at(durationMs)}
        {basic?.hesitations != null && ` · ${basic.hesitations} hesitation candidates (Estimated)`}
        {durationMs < ROUND_MIN_MS && " · under 10 seconds"}
      </p>
      <TakeLink sessionId={sessionId} ordinal={ordinal}>Listen</TakeLink>
    </li>
  );
}

function Result({ plan: p, takes, sessionId }: Parameters<DrillModule["Result"]>[0]) {
  const latest = p.rounds.map((r) => [...takes].reverse().find((t) => t.round.index === r.index));
  const completed = latest.filter((t) => t && t.durationMs >= ROUND_MIN_MS).length;
  const total = latest.reduce((n, t) => n + (t?.durationMs ?? 0), 0);
  return (
    <ResultPanel title="Gauntlet" source="measured" label="Rounds count when you spoke for 10 seconds or more.">
      <p className="text-xl font-semibold">
        Rounds completed: {completed} of {p.rounds.length} · {at(total)} speaking
      </p>
      <ol className="grid gap-2 sm:grid-cols-2">
        {p.rounds.map((r, i) =>
          latest[i] ? <Chip key={r.key} attemptId={latest[i]!.attemptId} label={`Round ${i + 1}`} durationMs={latest[i]!.durationMs} ordinal={takes.indexOf(latest[i]!) + 1} sessionId={sessionId} /> : null,
        )}
      </ol>
    </ResultPanel>
  );
}

const gauntlet: DrillModule = { plan, Result };
export default gauntlet;
