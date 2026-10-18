import { jamTopics } from "@/lib/content-runtime";
import { useEffect, useState } from "react";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { drillForType } from "@/content/drills";
import { JAM_TOPICS } from "@/content/jam-topics";
import type { DrillModule, DrillParams, DrillPlan } from "../drill-module";
import { BestLine, at } from "../parts";
import { pick, rng } from "../plan-helpers";
import { Figure, NeedsTranscript, ResultPanel, TakeLink, resultOf, useActivityResult } from "../results";

/**
 * Just a Minute (roadmap 10.2): sixty seconds on a topic without hesitation,
 * repetition or deviation. Flagging your own slips (F) is awareness training,
 * never a penalty game; clean seconds are an estimate from what is stored.
 */
const drill = drillForType("jam");

export function plan(seed: string, params: DrillParams): DrillPlan {
  const topic = jamTopics(JAM_TOPICS).find((t) => t.id === params.topic) ?? pick(rng(seed, "topic"), jamTopics(JAM_TOPICS));
  return {
    drill, seed, groupId: null, contentId: topic.id,
    params: { topic: topic.id },
    sessionPrompt: `Just a Minute: ${topic.text}`,
    rounds: [{ index: 0, key: "round", promptId: topic.id, prompt: topic.text, thinkSeconds: 5, speakSeconds: 60, familiarity: "unfamiliar", hint: "Speak for 60 seconds without hesitating, repeating yourself or going off topic." }],
  };
}

function Live({ speaking, mark }: Parameters<NonNullable<DrillModule["Live"]>>[0]) {
  const [flags, setFlags] = useState(0);
  const flag = () => {
    mark({ kind: "self_flag" });
    setFlags((n) => n + 1);
  };
  useEffect(() => {
    if (speaking) setFlags(0);
  }, [speaking]);
  useEffect(() => {
    if (!speaking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "f" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      flag();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <p className="text-meta text-muted-foreground">
        Press <kbd className="rounded border px-1 font-mono">F</kbd> to flag a slip you notice: a hesitation, a repeat or going off topic.
      </p>
      <Button variant="outline" size="sm" disabled={!speaking} onClick={flag} aria-keyshortcuts="F">
        <Flag aria-hidden /> Flag a slip{flags > 0 ? ` (${flags})` : ""}
      </Button>
    </div>
  );
}

function TakeResult({ attemptId, ordinal, sessionId, latest }: { attemptId: string; ordinal: number; sessionId: string; latest: boolean }) {
  const result = useActivityResult(attemptId);
  const jam = resultOf(result.data, "jam");
  if (result.error) return <p role="alert" className="text-meta text-destructive">This round's result couldn't be read. {String((result.error as Error).message ?? "")}</p>;
  if (!jam) return <p className="text-meta text-muted-foreground">Working out the result…</p>;
  return (
    <div className="space-y-3">
      <p className="text-xl font-semibold">
        {jam.cleanSeconds === null ? "Clean seconds need a transcript" : `About ${jam.cleanSeconds} clean seconds`}
      </p>
      {latest && <BestLine type="jam" field="cleanSeconds" format={(v) => `${v} clean seconds`} exclude={[attemptId]} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Figure label="Speaking time" value={at(jam.speakingMs)} />
        <Figure label="Hesitation candidates" value={jam.hesitations} />
        <Figure label="Long pauses" value={jam.longPauses > 0 ? `${jam.longPauses} (${(jam.longPauseMs / 1000).toFixed(1)} s)` : 0} />
        <Figure label="Repeats" value={jam.repeats} />
        <Figure label="Your flags" value={jam.flags} />
      </div>
      <NeedsTranscript reason={jam.unavailableReason} />
      <p className="text-meta text-muted-foreground">
        Each hesitation candidate and flag costs a second, each long pause its length and each repeat half a second. <TakeLink sessionId={sessionId} ordinal={ordinal}>Listen and review candidates</TakeLink>
      </p>
    </div>
  );
}

function Result({ takes, sessionId }: Parameters<DrillModule["Result"]>[0]) {
  return (
    <ResultPanel title="Just a Minute" label="Estimated from the transcript and the audio; your flags are your own.">
      {takes
        .map((take, i) => ({ take, ordinal: i + 1 }))
        .reverse()
        .map(({ take, ordinal }, i) => (
          <div key={take.attemptId} className={i > 0 ? "border-t pt-3" : undefined}>
            {takes.length > 1 && <p className="text-meta text-muted-foreground">Round {ordinal}</p>}
            <TakeResult attemptId={take.attemptId} ordinal={ordinal} sessionId={sessionId} latest={i === 0} />
          </div>
        ))}
    </ResultPanel>
  );
}

const jam: DrillModule = { plan, Live, Result, repeatable: true };
export default jam;
