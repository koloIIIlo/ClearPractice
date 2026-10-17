import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { drillForType } from "@/content/drills";
import { useSession } from "@/lib/ipc/queries";
import type { DrillModule, DrillParams, DrillPlan, PlanContext } from "../drill-module";
import { WINDOW_CLASSES, dailyFor, dailySessionId, shareText } from "../daily";
import { at } from "../parts";
import { NeedsTranscript, ResultPanel, TakeLink, resultOf, useActivityResult } from "../results";

/**
 * The daily prompt (roadmap 10.11): the day's prompt, think 10 seconds, speak
 * 60. The first take of the day is the official one; later takes are
 * practice. The share text holds a grid and counts, never your words.
 */
const drill = drillForType("daily");

export function plan(_seed: string, _params: DrillParams, ctx: PlanContext): DrillPlan {
  const { number, prompt } = dailyFor(ctx.today);
  return {
    drill, seed: `daily-${ctx.today}`, groupId: null, contentId: prompt.id,
    params: { number, prompt: prompt.id, date: ctx.today },
    sessionPrompt: `Daily #${number}: ${prompt.text}`,
    rounds: [{ index: 0, key: "round", promptId: prompt.id, prompt: prompt.text, thinkSeconds: 10, speakSeconds: 60, familiarity: "unfamiliar", hint: `Daily #${number} · think for 10 seconds, then speak for a minute.` }],
  };
}

function Grid({ windows }: { windows: readonly number[] }) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Your minute in six 10-second windows">
      {windows.map((w, i) => {
        const c = WINDOW_CLASSES[w];
        return (
          <li key={i} className="flex flex-col items-center gap-0.5 text-center">
            <span aria-hidden className="text-3xl leading-none">{c.square}</span>
            <span className="text-meta text-muted-foreground">
              {i * 10}–{(i + 1) * 10} s: {c.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Result({ plan: p, takes, sessionId }: Parameters<DrillModule["Result"]>[0]) {
  // The official take is the first of the day's session, which may be from an earlier visit.
  const session = useSession(sessionId);
  const official = session.data?.attempts.find((a) => !a.audioUnavailableReason)?.id ?? takes[0]?.attemptId;
  const officialTake = takes.find((t) => t.attemptId === official);
  const durationMs = session.data?.attempts.find((a) => a.id === official)?.durationMs ?? officialTake?.durationMs ?? 0;
  const result = useActivityResult(official);
  const grid = resultOf(result.data, "daily");
  const latest = takes.at(-1);
  const practice = latest && latest.attemptId !== official;
  const number = Number(p.params.number);
  const copy = async () => {
    if (!grid?.windows) return;
    try {
      await navigator.clipboard.writeText(shareText(number, durationMs, grid.windows));
      toast.success("Share text copied. It has no words from your answer.");
    } catch {
      toast.error("The clipboard isn't available here.");
    }
  };
  return (
    <ResultPanel title={`Daily #${number}`} label={p.rounds[0].prompt}>
      {practice && <p className="text-meta text-muted-foreground">Your latest take was practice; the grid shows the official one, the first of the day.</p>}
      {!grid ? (
        <p className="text-meta text-muted-foreground">Working out the grid…</p>
      ) : grid.windows ? (
        <>
          <Grid windows={grid.windows} />
          <p>
            {WINDOW_CLASSES.map((c) => ({ c, n: grid.windows!.filter((w) => w === c.code).length }))
              .filter(({ n }) => n > 0)
              .map(({ c, n }) => `${n} ${c.label}`)
              .join(" · ")}
          </p>
          <NeedsTranscript reason={grid.transcribed ? null : grid.unavailableReason} />
          <Button variant="outline" onClick={() => void copy()}>
            <Copy aria-hidden /> Copy share text
          </Button>
        </>
      ) : (
        <p className="text-muted-foreground">{grid.unavailableReason}</p>
      )}
      <p className="text-meta text-muted-foreground">
        Official take: {at(durationMs)}.{" "}
        {session.data && <TakeLink sessionId={sessionId} ordinal={session.data.attempts.findIndex((a) => a.id === official) + 1}>Listen</TakeLink>}
      </p>
    </ResultPanel>
  );
}

const daily: DrillModule = { plan, Result, repeatable: true, fixedPlan: true, sessionId: (p) => dailySessionId(String(p.params.date)) };
export default daily;
