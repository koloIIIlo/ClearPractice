import { useQueries } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { Panel } from "@/components/page";
import { drillForType } from "@/content/drills";
import { EMPHASIS_SENTENCES, type EmphasisSentence } from "@/content/emphasis-sentences";
import { useIpc } from "@/lib/ipc";
import { keys } from "@/lib/ipc/queries";
import type { DrillModule, DrillParams, DrillPlan, DrillRound } from "../drill-module";
import { pick, rng, sample } from "../plan-helpers";
import { DrillCheck, ResultPanel, TakeLink, resultOf, useActivityResult } from "../results";

/**
 * The emphasis game (roadmap 10.6): stress a different word and hear the
 * meaning change. Seven short rounds; the native analysis estimates which word
 * carried the strongest beat. When it can't line the beats up, you judge
 * yourself (Your note), and the two are counted apart (A-35).
 */
const drill = drillForType("emphasis");
const ROUNDS = 7;

export function plan(seed: string, _params: DrillParams): DrillPlan {
  const sentences = sample(rng(seed, "sentences"), EMPHASIS_SENTENCES, ROUNDS);
  const targetRand = rng(seed, "targets");
  const targets = sentences.map((s) => pick(targetRand, s.targets));
  const rounds: DrillRound[] = sentences.map((s, index) => {
    const words = s.text.split(" ");
    const word = words[targets[index].word].replace(/[.?]$/, "");
    return {
      index, key: `s${index + 1}`, promptId: s.id, prompt: `Stress “${word}”`, thinkSeconds: 2, speakSeconds: 8, familiarity: "familiar",
      hint: `Meaning: ${targets[index].meaning}`,
      card: <Sentence sentence={s} target={targets[index].word} />,
    };
  });
  return {
    drill, seed, groupId: null, contentId: null,
    params: { sentences: sentences.map((s) => s.text), targets: targets.map((t) => String(t.word)), ids: sentences.map((s) => s.id) },
    sessionPrompt: "Emphasis game · 7 sentences",
    rounds,
  };
}

function Sentence({ sentence, target }: { sentence: EmphasisSentence; target: number }) {
  return (
    <Panel className="text-center">
      <p className="text-2xl leading-relaxed">
        {sentence.text.split(" ").map((w, i) => (
          <span key={i}>
            {i > 0 && " "}
            {i === target ? <strong className="underline decoration-2 underline-offset-4">{w}</strong> : w}
          </span>
        ))}
      </p>
    </Panel>
  );
}

function Row({ round, attemptId, ordinal, sessionId, words }: { round: DrillRound; attemptId: string; ordinal: number; sessionId: string; words: string[] }) {
  const result = useActivityResult(attemptId);
  const e = resultOf(result.data, "emphasis");
  const target = e?.target ?? null;
  return (
    <li className="space-y-1 border-t pt-2 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          {round.index + 1}. {round.prompt}
        </span>
        <TakeLink sessionId={sessionId} ordinal={ordinal}>Listen</TakeLink>
      </div>
      {!e ? (
        <p className="text-meta text-muted-foreground">Working out the beats…</p>
      ) : e.aligned && e.peakWord !== null ? (
        <p className="flex items-center gap-1.5 text-meta">
          {e.hit ? <Check aria-hidden className="size-4 text-primary" /> : <X aria-hidden className="size-4 text-muted-foreground" />}
          Strongest beat: <strong>{words[e.peakWord]?.replace(/[.?]$/, "")}</strong>
          <span className="text-muted-foreground">{e.hit ? "· on the target" : target !== null ? `· the target was “${words[target]?.replace(/[.?]$/, "")}”` : ""}</span>
        </p>
      ) : (
        <div className="space-y-1">
          <p className="text-meta text-muted-foreground">{e.unavailableReason ?? "Couldn't line up the beats this time."} Listen and judge yourself.</p>
          <DrillCheck attemptId={attemptId} checkId="stressed_target" question="Did you stress the word in bold?" yes="Yes, I stressed it" no="Not quite" />
        </div>
      )}
    </li>
  );
}

function Totals({ takes }: { takes: { attemptId: string }[] }) {
  const ipc = useIpc();
  const results = useQueries({ queries: takes.map((t) => ({ queryKey: keys.activityResult(t.attemptId), queryFn: () => ipc.getActivityResult(t.attemptId), retry: false })) });
  const checks = useQueries({ queries: takes.map((t) => ({ queryKey: keys.selfChecks(t.attemptId), queryFn: () => ipc.listSelfChecks(t.attemptId) })) });
  const estimated = results.filter((r) => r.data?.kind === "emphasis" && r.data.hit === true).length;
  const judged = results.filter((r, i) => r.data?.kind === "emphasis" && !r.data.aligned && checks[i].data?.some((c) => c.checkId === "stressed_target" && c.value)).length;
  return (
    <p className="text-xl font-semibold">
      Estimated: {estimated} of {takes.length}
      {judged > 0 && <span className="text-base font-normal text-muted-foreground"> · Your judgement: {judged} more</span>}
    </p>
  );
}

function Result({ plan: p, takes, sessionId }: Parameters<DrillModule["Result"]>[0]) {
  const sentences = p.params.sentences as string[];
  return (
    <ResultPanel title="Emphasis game" label="Estimated from loudness, pitch and length in each take. Your own judgements are counted apart.">
      <Totals takes={takes} />
      <ol className="space-y-2">
        {takes.map((t, i) => (
          <Row key={t.attemptId} round={t.round} attemptId={t.attemptId} ordinal={i + 1} sessionId={sessionId} words={(sentences[t.round.index] ?? "").split(" ")} />
        ))}
      </ol>
    </ResultPanel>
  );
}

const emphasis: DrillModule = { plan, Result };
export default emphasis;

