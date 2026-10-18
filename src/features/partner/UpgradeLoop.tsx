import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Headphones, Info, Square, Volume2 } from "lucide-react";
import { EvidenceLabel } from "@/components/evidence";
import { ErrorState, LoadingBlock, Page, Panel, SectionTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { useRecorder } from "@/features/practice/recorder";
import { RecorderPanel, useRecorderGuard } from "@/features/practice/RecorderPanel";
import { diffWords } from "@/lib/diff";
import { useIpc } from "@/lib/ipc";
import type { PracticeContext } from "@/lib/ipc/client";
import { keys, usePreferences } from "@/lib/ipc/queries";
import type { UpgradeRun } from "@/lib/ipc/schemas";
import { pickPartnerVoice, speakGroups } from "@/lib/speech";
import { cn } from "@/lib/utils";
import { useOfflineVoices } from "./voices";

const STEPS = ["Compare", "Shadow", "Retell", "Done"] as const;
/** Every take of a loop is recorded with this prompt. */
export const UPGRADE_PROMPT = "Shadow and retell a clearer version of your answer";

const sentencesOf = (text: string) => (text.match(/[^.!?]+[.!?]*/g) ?? [text]).map((s) => s.trim()).filter(Boolean);

/** Your answer and the clearer version, word by word: removed words struck through, added words underlined. */
export function WordDiff({ from, to }: { from: string; to: string }) {
  return (
    <p className="leading-relaxed">
      {diffWords(from, to).map((part, i) => {
        const space = i > 0 ? " " : "";
        if (part.op === "del") {
          return (
            <span key={i}>
              {space}
              <del className="text-[var(--cp-diff-removed)] line-through">
                <span className="sr-only">removed: </span>
                {part.text}
              </del>
            </span>
          );
        }
        if (part.op === "add") {
          return (
            <span key={i}>
              {space}
              <ins className="text-[var(--cp-diff-added)] underline decoration-2 underline-offset-2">
                <span className="sr-only">added: </span>
                {part.text}
              </ins>
            </span>
          );
        }
        return <span key={i}>{space}{part.text}</span>;
      })}
    </p>
  );
}

/**
 * The upgrade loop (roadmap 13.10): learn from a clearer version of your own
 * answer. Compare, shadow it sentence by sentence, retell it from memory with
 * the text hidden, done. The shadow and retell takes are recorded in the
 * loop's own session (exercise type `upgrade`); the retell take completes it.
 */
export function UpgradeLoop({ run }: { run: UpgradeRun }) {
  const ipc = useIpc();
  const native = ipc.recordingMode === "native";
  const { preferences } = usePreferences();
  const voices = useOfflineVoices();
  const voice = pickPartnerVoice(voices, preferences.partnerVoice, "any");
  const [step, setStep] = useState(0);
  const sentences = sentencesOf(run.upgraded);
  const [reading, setReading] = useState<number | null>(null);
  const stopReading = useRef<(() => void) | null>(null);
  useEffect(() => () => stopReading.current?.(), []);
  const key = step === 2 ? "retell" : "shadow";
  const context: PracticeContext = {
    sessionId: run.loopSessionId,
    exerciseId: "ex-upgrade",
    exerciseVersion: 1,
    exerciseType: "upgrade",
    prompt: UPGRADE_PROMPT,
    outline: { point: "", reason: "", example: "" },
    conditions: { familiarity: "familiar", preparationSeconds: 0, targetSeconds: 120, audience: null, followUp: false },
    activity: { version: 1, seed: run.id.slice(0, 64), params: { sourceAttemptId: run.attemptId } },
    step: { index: key === "shadow" ? 1 : 2, key },
  };
  const rec = useRecorder(UPGRADE_PROMPT, context);
  const guard = useRecorderGuard(rec);
  const takes = useRef<{ shadow: string | null; retell: string | null }>({ shadow: null, retell: null });
  const seen = useRef(rec.takes.length);
  useEffect(() => {
    if (rec.takes.length <= seen.current) return;
    seen.current = rec.takes.length;
    const id = rec.takes[rec.takes.length - 1].asset.attemptId;
    if (step === 1) {
      takes.current.shadow = id;
      setStep(2);
    } else if (step === 2) {
      takes.current.retell = id;
      setStep(3);
    }
  }, [rec.takes.length]);

  const read = () => {
    stopReading.current?.();
    if (!voice) return;
    // Pauses long enough to say the sentence back.
    const words = run.upgraded.split(/\s+/).length / Math.max(1, sentences.length);
    stopReading.current = speakGroups(sentences, {
      voice, rate: preferences.partnerRate, pauseMs: Math.max(2_500, Math.round(words * 450)),
      onGroup: setReading, onEnd: () => { setReading(null); stopReading.current = null; },
    });
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-meta text-muted-foreground">Upgrade loop · from take {run.takeOrdinal}</p>
        <h1 className="text-title font-semibold tracking-tight">Learn from a clearer version of your answer</h1>
        <p className="text-muted-foreground">Your meaning and ideas stay; only the wording changes.</p>
      </header>
      <ol className="flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined}
            className={cn("rounded-full border px-3 py-1 text-meta", i === step ? "border-primary bg-primary/10 font-medium" : i < step ? "text-muted-foreground" : "")}>
            {i < step && <CheckCircle2 aria-hidden className="mr-1 inline size-3.5" />}
            {i + 1}. {label}
          </li>
        ))}
      </ol>
      {!native && (
        <p role="note" className="flex items-center gap-2 text-meta text-muted-foreground">
          <Info aria-hidden className="size-4 shrink-0" /> Browser preview: recording is simulated.
        </p>
      )}

      {step === 0 && (
        <Panel className="space-y-4" aria-labelledby="compare-heading">
          <SectionTitle id="compare-heading">Compare</SectionTitle>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <h3 className="font-medium">Your answer</h3>
              <p className="text-muted-foreground">{run.transcriptText}</p>
            </div>
            <div className="space-y-1">
              <h3 className="flex flex-wrap items-center gap-2 font-medium">A clearer version <EvidenceLabel source="ai" /></h3>
              <p>{run.upgraded}</p>
            </div>
          </div>
          <div className="space-y-1">
            <h3 className="font-medium">Word by word</h3>
            <WordDiff from={run.transcriptText} to={run.upgraded} />
          </div>
          {run.changes.length > 0 && (
            <div className="space-y-1">
              <h3 className="font-medium">What changed</h3>
              <ul className="list-disc space-y-1 pl-5">
                {run.changes.map((c, i) => (
                  <li key={i}>
                    “{c.from}” → “{c.to}”{c.why && <span className="text-muted-foreground"> · {c.why}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button onClick={() => setStep(1)}>Next: shadow it</Button>
        </Panel>
      )}

      {step === 1 && (
        <Panel className="space-y-4" aria-labelledby="shadow-heading">
          <SectionTitle id="shadow-heading">Shadow it</SectionTitle>
          <p>
            {voice
              ? "Start recording, then play the clearer version. After each sentence there is a pause: say the sentence back. One take holds your whole shadowing."
              : "Start recording, then read each sentence aloud. No offline voice was found on this computer, so the sentences are shown instead of read."}
          </p>
          <p className="text-meta text-muted-foreground">
            <Headphones aria-hidden className="mr-1 inline size-4" /> Use headphones, so the take holds only your voice.
          </p>
          <ol className="space-y-1" aria-label="Sentences">
            {sentences.map((s, i) => (
              <li key={i} className={cn("rounded-md px-2 py-1", reading === i && "bg-primary/10 font-medium")} aria-current={reading === i ? "true" : undefined}>
                {s}
              </li>
            ))}
          </ol>
          {voice && (
            <Button variant="outline" onClick={() => (stopReading.current ? stopReading.current() : read())}>
              {reading !== null ? <><Square aria-hidden /> Stop reading</> : <><Volume2 aria-hidden /> Play sentence by sentence</>}
            </Button>
          )}
          <RecorderPanel rec={rec} compact hideCountdown labels={{ record: "Record your shadowing", again: "Record your shadowing", stop: "Stop and save" }} />
        </Panel>
      )}

      {step === 2 && (
        <Panel className="space-y-4" aria-labelledby="retell-heading">
          <SectionTitle id="retell-heading">Retell it from memory</SectionTitle>
          <p>The clearer version is hidden now. Say your answer again in your own words, using what you noticed.</p>
          <RecorderPanel rec={rec} compact hideCountdown onBeforeStart={() => stopReading.current?.()} labels={{ record: "Record your retelling", again: "Record your retelling", stop: "Stop and save" }} />
        </Panel>
      )}

      {step === 3 && (
        <Panel className="space-y-3" aria-labelledby="done-heading">
          <SectionTitle id="done-heading">Done</SectionTitle>
          <p>You compared, shadowed and retold your answer. Listen to how your first answer and your retelling differ.</p>
          <div className="flex flex-wrap gap-2">
            {takes.current.retell && (
              <Button asChild>
                <Link to={`/compare?a=${run.attemptId}&b=${takes.current.retell}`}>Compare your first answer and your retelling</Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to={`/sessions/${run.loopSessionId}`}>Open the loop's session</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link to={`/sessions/${run.sessionId}`}>Back to your answer</Link>
            </Button>
          </div>
        </Panel>
      )}
      {guard}
    </div>
  );
}

export function UpgradeLoopPage() {
  const { runId = "" } = useParams();
  const ipc = useIpc();
  const run = useQuery({ queryKey: keys.upgradeRun(runId), queryFn: () => ipc.getUpgradeRun(runId) });
  return (
    <Page className="max-w-4xl">
      {run.error ? (
        <ErrorState error={run.error} title="This upgrade couldn't be opened" onRetry={() => void run.refetch()} />
      ) : run.data ? (
        <UpgradeLoop run={run.data} />
      ) : (
        <LoadingBlock rows={3} label="Opening the upgrade" />
      )}
    </Page>
  );
}
