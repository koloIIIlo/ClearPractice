import { useState } from "react";
import { useParams } from "react-router";
import { Pause, Play } from "lucide-react";
import { EvidenceLabel } from "@/components/evidence";
import { LoadingBlock, Page, PageHeader, Panel, QueryView } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatClock } from "@/lib/format";
import { useAttemptReview, useSession } from "@/lib/ipc/queries";
import type { Attempt, AttemptReview } from "@/lib/ipc/schemas";
import { cn } from "@/lib/utils";
import { useIpc } from "@/lib/ipc";
import { NativeSession } from "@/features/sessions/NativeSession";
import { useSimulatedPlayback, type Playback } from "./playback";

export function ComparePage() {
  const ipc = useIpc();
  const { sessionId } = useParams();
  const session = useSession(sessionId);

  return (
    <Page className="max-w-6xl">
      <QueryView query={session} loading={<LoadingBlock rows={4} label="Loading session" />}>
        {(s) => {
          if (ipc.recordingMode === "native") return <NativeSession key={s.id} session={s} />;
          const [a, b] = [s.attempts[0], s.attempts.at(-1)!];
          return (
            <>
              <PageHeader
                title="Compare takes"
                description={s.prompt}
                meta={s.focus ? `Your focus: ${s.focus}` : undefined}
              />
              <Comparison a={a} b={b} />
            </>
          );
        }}
      </QueryView>
    </Page>
  );
}

function Comparison({ a, b }: { a: Attempt; b: Attempt }) {
  const ra = useAttemptReview(a.id);
  const rb = useAttemptReview(b.id);
  const pa = useSimulatedPlayback(a.durationMs);
  const pb = useSimulatedPlayback(b.durationMs);
  const [preferred, setPreferred] = useState<string>("");

  // A single active player: starting one take pauses the other (§6 Attempt comparison).
  const play = (which: "a" | "b") => {
    const [self, other] = which === "a" ? [pa, pb] : [pb, pa];
    if (!self.playing && other.playing) other.toggle();
    self.toggle();
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <TakeColumn attempt={a} review={ra.data} playback={pa} onPlay={() => play("a")} active={pa.playing} />
        <TakeColumn attempt={b} review={rb.data} playback={pb} onPlay={() => play("b")} active={pb.playing} />
      </div>

      {ra.data && rb.data && (
        <Panel>
          <h2 className="mb-1 font-semibold">Side by side</h2>
          <p className="mb-3 text-meta text-muted-foreground">
            Differences are descriptive. A faster or slower pace isn't automatically better.
          </p>
          <table className="w-full text-left">
            <thead className="text-meta text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 font-medium">Measure</th>
                <th scope="col" className="py-1 text-right font-medium">Take {a.ordinal}</th>
                <th scope="col" className="py-1 text-right font-medium">Take {b.ordinal}</th>
                <th scope="col" className="py-1 text-right font-medium"><span className="sr-only">Source</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ra.data.metrics.map((m) => {
                const other = rb.data!.metrics.find((x) => x.key === m.key);
                const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "Unavailable" : `${v}${m.unit ? ` ${m.unit}` : ""}`);
                return (
                  <tr key={m.key}>
                    <th scope="row" className="py-2 font-normal">{m.label}</th>
                    <td className="py-2 text-right tabular-nums">{fmt(m.value)}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(other?.value)}</td>
                    <td className="py-2 text-right"><EvidenceLabel source={m.source} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}

      <Panel>
        <fieldset>
          <legend className="mb-3 font-semibold">Which take felt clearer to you?</legend>
          <RadioGroup value={preferred} onValueChange={setPreferred} className="flex flex-wrap gap-3">
            {[a, b].map((t) => (
              <Label key={t.id} htmlFor={`pref-${t.id}`} className="flex items-center gap-2 font-normal">
                <RadioGroupItem id={`pref-${t.id}`} value={t.id} /> Take {t.ordinal} felt clearer
              </Label>
            ))}
            <Label htmlFor="pref-same" className="flex items-center gap-2 font-normal">
              <RadioGroupItem id="pref-same" value="same" /> About the same
            </Label>
          </RadioGroup>
          <p className="mt-2 text-meta text-muted-foreground">Saved as your own judgement, separate from any measures.</p>
        </fieldset>
      </Panel>
    </div>
  );
}

function TakeColumn({
  attempt,
  review,
  playback,
  onPlay,
  active,
}: {
  attempt: Attempt;
  review: AttemptReview | undefined;
  playback: Playback;
  onPlay: () => void;
  active: boolean;
}) {
  const raw = review?.revisions.find((r) => r.kind === "raw");
  return (
    <Panel className={cn(active && "border-primary")} aria-label={`Take ${attempt.ordinal}`}>
      <div className="mb-3 flex items-center gap-3">
        <Button size="icon" onClick={onPlay} aria-label={`${active ? "Pause" : "Play"} take ${attempt.ordinal}`}>
          {active ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
        <div>
          <p className="font-semibold">
            Take {attempt.ordinal} {active && <span className="text-meta font-normal text-primary">· playing</span>}
          </p>
          <p className="text-meta text-muted-foreground tabular-nums">
            {formatClock(playback.positionMs)} / {formatClock(attempt.durationMs)}
          </p>
        </div>
      </div>
      {raw ? (
        <p className="text-body leading-relaxed">{raw.segments.map((s) => s.text).join(" ")}</p>
      ) : (
        <LoadingBlock rows={2} label="Loading transcript" />
      )}
    </Panel>
  );
}
