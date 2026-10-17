import { useEffect, useRef, useState } from "react";
import { Bomb } from "lucide-react";
import { drillForType } from "@/content/drills";
import { WORD_BOMB_WORDS } from "@/content/word-bomb-words";
import type { DrillModule, DrillParams, DrillPlan, PlanContext } from "../drill-module";
import { at } from "../parts";
import { FALLBACK_PROMPT, pick, promptsWhere, rng, sample } from "../plan-helpers";
import { Figure, NeedsTranscript, ResultPanel, TakeLink, resultOf, useActivityResult } from "../results";

/**
 * Word bomb (roadmap 10.4), an improv game: answer a familiar question for 90
 * seconds while three words appear; weave each one in. A word counts when its
 * stem is said from a second before it appeared (native result).
 */
const drill = drillForType("word_bomb");
const SHOW_MS = 10_000;

/** Three times between 15 and 75 seconds, at least 15 seconds apart. */
export function bombTimes(seed: string): number[] {
  const rand = rng(seed, "times");
  const t1 = 15 + Math.floor(rand() * 11);
  const t2 = t1 + 15 + Math.floor(rand() * 11);
  const t3 = Math.min(75, t2 + 15 + Math.floor(rand() * 11));
  return [t1, t2, t3];
}

export function plan(seed: string, params: DrillParams, ctx: PlanContext): DrillPlan {
  const familiar = promptsWhere(ctx.prompts, (p) => p.conditions.familiarity === "familiar");
  const prompt = familiar.find((p) => p.id === params.prompt) ?? (familiar.length ? pick(rng(seed, "prompt"), familiar) : null);
  const words = sample(rng(seed, "words"), WORD_BOMB_WORDS, 3);
  const times = bombTimes(seed);
  const text = prompt?.text ?? FALLBACK_PROMPT;
  return {
    drill, seed, groupId: null, contentId: prompt?.id ?? null,
    params: { prompt: prompt?.id ?? "fallback", words: words.map((w) => `${w.singular}|${w.plural}`), wordIds: words.map((w) => w.id), times: times.map(String) },
    sessionPrompt: `Word bomb: ${text}`,
    rounds: [{ index: 0, key: "round", promptId: prompt?.id ?? null, prompt: text, thinkSeconds: 10, speakSeconds: 90, familiarity: "familiar", hint: "Three words will appear while you speak. Weave each one into your answer." }],
  };
}

const wordsOf = (p: DrillPlan) => (p.params.words as string[]).map((forms) => forms.split("|")[0]);

function Live({ plan: p, speaking, elapsedMs, mark }: Parameters<NonNullable<DrillModule["Live"]>>[0]) {
  const words = wordsOf(p);
  const ids = p.params.wordIds as string[];
  const times = (p.params.times as string[]).map((t) => Number(t) * 1000);
  const shown = useRef(new Set<number>());
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    if (!speaking) shown.current = new Set();
  }, [speaking]);
  useEffect(() => {
    if (!speaking) return;
    times.forEach((t, i) => {
      if (elapsedMs >= t && !shown.current.has(i)) {
        shown.current.add(i);
        mark({ kind: "word_shown", data: { index: i, word: ids[i] } });
        setAnnounce(`New word: ${words[i]}.`);
      }
    });
  });
  // The latest word stays until the next one or for ten seconds.
  const visible = speaking ? times.map((t, i) => ({ t, i })).filter(({ t, i }) => elapsedMs >= t && elapsedMs < Math.min(t + SHOW_MS, times[i + 1] ?? Infinity)).at(-1) : undefined;
  return (
    <div className="flex min-h-16 w-full flex-col items-center justify-center gap-1 text-center">
      <div aria-live="assertive" className="sr-only">{announce}</div>
      {visible ? (
        <p className="inline-flex items-center gap-2 rounded-lg border-2 border-primary px-4 py-2 text-xl motion-safe:animate-in motion-safe:slide-in-from-bottom-2">
          <Bomb aria-hidden className="size-5 text-primary" /> Weave in: <strong>{words[visible.i]}</strong>
        </p>
      ) : (
        <p className="text-meta text-muted-foreground">{speaking ? `Words so far: ${shown.current.size} of 3` : "Three words will appear while you speak."}</p>
      )}
    </div>
  );
}

function Result({ plan: p, takes, sessionId }: Parameters<DrillModule["Result"]>[0]) {
  const take = takes.at(-1)!;
  const result = useActivityResult(take.attemptId);
  const bomb = resultOf(result.data, "word_bomb");
  const words = wordsOf(p);
  return (
    <ResultPanel title="Word bomb" label={p.rounds[0].prompt}>
      {!bomb ? (
        <p className="text-meta text-muted-foreground">Working out the result…</p>
      ) : (
        <>
          <p className="text-xl font-semibold">{bomb.woven === null ? `${bomb.shown} words appeared` : `Words woven in: ${bomb.woven} of ${bomb.shown}`}</p>
          <ul className="space-y-1">
            {words.map((word, i) => {
              const spoken = bomb.spokenAtMs?.[i];
              return (
                <li key={word} className="flex flex-wrap items-baseline gap-x-2">
                  <strong>{word}</strong>
                  <span className="text-meta text-muted-foreground">
                    {spoken === undefined || bomb.spokenAtMs === null ? "needs a transcript" : spoken >= 0 ? `said at ${at(spoken)}` : i < bomb.shown ? "not found after it appeared" : "didn't appear"}
                  </span>
                </li>
              );
            })}
          </ul>
          <NeedsTranscript reason={bomb.unavailableReason} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Figure label="Time spoken" value={at(take.durationMs)} />
          </div>
          <p className="text-meta text-muted-foreground">
            <TakeLink sessionId={sessionId} ordinal={takes.length}>Listen to the round</TakeLink>
          </p>
        </>
      )}
    </ResultPanel>
  );
}

const wordBomb: DrillModule = { plan, Live, Result, repeatable: true };
export default wordBomb;
