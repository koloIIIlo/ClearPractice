import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Eye } from "lucide-react";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/audio-player";
import { EvidenceLabel } from "@/components/evidence";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { seededRandom } from "@/lib/engagement/random";
import { useIpc } from "@/lib/ipc";
import { keys, useSession } from "@/lib/ipc/queries";
import type { AttemptTranscript } from "@/lib/ipc/schemas";

/** One side of the comparison: a take and the session it belongs to. */
export type AttemptRef = { attemptId: string; sessionId: string; label: string };
type Side = "a" | "b";

/** Level matching never turns a take down by more than this (−12 dB). */
const MIN_GAIN = 10 ** (-12 / 20);

/**
 * Gains that make the two takes about equally loud (8.5): the louder one is
 * turned down to the quieter one's level, never below −12 dB, and nothing is
 * ever boosted above 1. Silence or an unknown level leaves both at 1.
 */
export function matchGains(rmsA: number, rmsB: number): { a: number; b: number } {
  if (!(rmsA > 0) || !(rmsB > 0)) return { a: 1, b: 1 };
  if (rmsA > rmsB) return { a: Math.max(MIN_GAIN, rmsB / rmsA), b: 1 };
  return { a: 1, b: Math.max(MIN_GAIN, rmsA / rmsB) };
}

/** Speech level from waveform peaks: the RMS of the louder half, so long pauses don't lower it. */
export function rmsFromPeaks(peaks: readonly number[]): number {
  const loud = [...peaks].sort((x, y) => y - x).slice(0, Math.max(1, Math.ceil(peaks.length / 2)));
  if (peaks.length === 0) return 0;
  return Math.sqrt(loud.reduce((sum, p) => sum + p * p, 0) / loud.length);
}

/** Which take is X in blind mode, from a seed so the order holds while you listen. */
export function blindOrder(seed: string): [Side, Side] {
  return seededRandom(seed)() < 0.5 ? ["a", "b"] : ["b", "a"];
}

function measureRows(t: AttemptTranscript | undefined) {
  const m = t?.revision?.measures;
  if (!m) return null;
  const minutes = m.speechSpanMs ? m.speechSpanMs / 60_000 : null;
  const inside = (m.pauseKinds ?? []).filter((k) => k === "mid_clause").length;
  return [
    ["Pace", m.paceWpm != null ? `${Math.round(m.paceWpm)} words a minute` : "unavailable"],
    ["Mean run", m.runs ? `${m.runs.meanWords} words` : "unavailable"],
    ["Pauses inside a clause", m.pauseKinds && minutes ? `${(inside / minutes).toFixed(1)} a minute` : "unavailable"],
    ["Different words", m.differentPer50 != null ? `${Math.round(m.differentPer50)} in every 50` : "unavailable"],
    ["Hesitation candidates", String(m.fillers.filter((f) => f.decision !== "dismissed").length)],
  ] as const;
}

/**
 * Hear two takes back to back at the same point, at matched loudness, and
 * optionally without knowing which is which (roadmap 8.5). Your choice is
 * labelled Your note: the session's preferred take when both takes are in one
 * session (4.14), a comparison otherwise.
 */
export function AbListen({ a, b, sessionTitle, onBlindChange }: { a: AttemptRef; b: AttemptRef; sessionTitle: string; onBlindChange?: (hidden: boolean) => void }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const id = useId();
  const players = { a: useRef<AudioPlayerHandle>(null), b: useRef<AudioPlayerHandle>(null) };
  const [matched, setMatched] = useState(true);
  const [blind, setBlind] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [order, setOrder] = useState<[Side, Side]>(["a", "b"]);
  const [last, setLast] = useState<Side>("a");
  const sameSession = a.sessionId === b.sessionId;
  const refs = { a, b };

  const urls = useQueries({ queries: [a, b].map((t) => ({ queryKey: ["recording-playback", t.attemptId], queryFn: () => ipc.getRecordingPlaybackUrl(t.attemptId), retry: false })) });
  const peaks = useQueries({ queries: [a, b].map((t) => ({ queryKey: ["recording-waveform-level", t.attemptId], queryFn: () => ipc.getRecordingWaveform(t.attemptId), retry: false, staleTime: Infinity })) });
  const transcripts = useQueries({ queries: [a, b].map((t) => ({ queryKey: ["attempt-transcript", t.attemptId], queryFn: () => ipc.getAttemptTranscript(t.attemptId), retry: false })) });
  const session = useSession(sameSession ? a.sessionId : undefined);
  const comparisons = useQuery({ queryKey: keys.comparisons(a.attemptId), queryFn: () => ipc.listComparisons(a.attemptId), enabled: !sameSession });

  const levels = peaks.map((p) => (p.data ? rmsFromPeaks(p.data.peaks) : 0));
  const gains = matched ? matchGains(levels[0], levels[1]) : { a: 1, b: 1 };
  const hidden = blind && !revealed;
  useEffect(() => onBlindChange?.(hidden), [hidden, onBlindChange]);

  // Your saved choice, as a/b/same.
  const savedChoice: Side | "same" | null = sameSession
    ? session.data?.preferredTake === "same"
      ? "same"
      : session.data?.preferredTake === a.attemptId
        ? "a"
        : session.data?.preferredTake === b.attemptId
          ? "b"
          : null
    : (() => {
        const c = comparisons.data?.find((x) => (x.aAttempt === a.attemptId && x.bAttempt === b.attemptId) || (x.aAttempt === b.attemptId && x.bAttempt === a.attemptId));
        if (!c) return null;
        if (c.preferred === "same" || c.aAttempt === a.attemptId) return c.preferred;
        return c.preferred === "a" ? "b" : "a";
      })();
  const [choice, setChoice] = useState<Side | "same" | null>(null);
  const shown = choice ?? (hidden ? null : savedChoice);

  const save = useMutation({ meta: { engagement: "review" },
    mutationFn: async (preferred: Side | "same") => {
      if (sameSession) await ipc.setPreferredTake(a.sessionId, preferred === "same" ? "same" : refs[preferred].attemptId);
      else await ipc.saveComparison(a.attemptId, b.attemptId, preferred, blind);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sameSession ? ["session", a.sessionId] : keys.comparisons(a.attemptId) });
    },
  });
  const choose = (preferred: Side | "same") => {
    setChoice(preferred);
    save.mutate(preferred);
  };

  const name = (side: Side) => (hidden ? (order[0] === side ? "X" : "Y") : side.toUpperCase());
  const play = (side: Side) => {
    setLast(side);
    players[side].current?.play();
  };
  /** Jump to the other take at the same elapsed time. */
  const switchSides = () => {
    const from = players[last].current;
    const other: Side = last === "a" ? "b" : "a";
    const at = from?.positionMs() ?? 0;
    players[other].current?.seek(at);
    play(other);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key.toLowerCase();
    const side = hidden ? (key === "x" ? order[0] : key === "y" ? order[1] : null) : key === "a" ? "a" : key === "b" ? "b" : null;
    if (side) {
      e.preventDefault();
      play(side);
    } else if (key === "s") {
      e.preventDefault();
      switchSides();
    }
  };
  const toggleBlind = (on: boolean) => {
    players.a.current?.pause();
    players.b.current?.pause();
    setBlind(on);
    setRevealed(false);
    setChoice(null);
    if (on) setOrder(blindOrder(`${a.attemptId}|${b.attemptId}|${Date.now()}`));
  };

  const sides: Side[] = hidden ? order : ["a", "b"];
  const rows = transcripts.map((t) => measureRows(t.data));
  return (
    <Panel className="space-y-4" aria-label="A/B listen" onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Listen A/B · {sessionTitle}</h2>
        <p className="text-meta text-muted-foreground">Keys: {hidden ? "X, Y" : "A, B"} to play · S to switch at the same point</p>
      </div>
      <ul className="space-y-2">
        {sides.map((side) => (
          <li key={side} className="flex flex-wrap items-center gap-3">
            <Button variant={last === side ? "default" : "outline"} className="w-10 shrink-0 px-0" aria-label={`Play ${name(side)}`} onClick={() => play(side)}>
              {name(side)}
            </Button>
            <span className="min-w-40 text-meta">{hidden ? `Take ${name(side)}` : refs[side].label}</span>
            {urls[side === "a" ? 0 : 1].data ? (
              <AudioPlayer
                ref={players[side]}
                src={urls[side === "a" ? 0 : 1].data!}
                label={hidden ? `take ${name(side)}` : refs[side].label}
                volume={gains[side]}
                className="min-w-0 flex-1"
              />
            ) : (
              <span className="text-meta text-muted-foreground">{urls[side === "a" ? 0 : 1].error ? "This recording is unavailable." : "Opening…"}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Button variant="outline" onClick={switchSides}>
          <ArrowLeftRight aria-hidden /> Switch at the same point
        </Button>
        <Label htmlFor={`${id}-match`} className="flex items-center gap-2 font-normal">
          <Checkbox id={`${id}-match`} checked={matched} onCheckedChange={(v) => setMatched(v === true)} /> Level-matched
        </Label>
        <Label htmlFor={`${id}-blind`} className="flex items-center gap-2 font-normal">
          <Checkbox id={`${id}-blind`} checked={blind} onCheckedChange={(v) => toggleBlind(v === true)} /> Hide which is which
        </Label>
      </div>
      {matched && <p className="text-meta text-muted-foreground">So the louder take doesn't simply sound better.</p>}

      <fieldset className="space-y-2">
        <legend className="mb-1 font-medium">Which sounded clearer to you?</legend>
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup type="single" variant="outline" aria-label="Which sounded clearer to you?" value={shown ?? ""} onValueChange={(v) => v && choose(v as Side | "same")}>
            {sides.map((side) => (
              <ToggleGroupItem key={side} value={side} className="h-10 px-4">
                {hidden ? `${name(side)} sounds clearer` : name(side)}
              </ToggleGroupItem>
            ))}
            <ToggleGroupItem value="same" className="h-10 px-4">About the same</ToggleGroupItem>
          </ToggleGroup>
          <EvidenceLabel source="note" />
          {hidden && (
            <Button variant="ghost" disabled={!choice} onClick={() => setRevealed(true)}>
              <Eye aria-hidden /> Reveal
            </Button>
          )}
        </div>
        <p role="status" className="text-meta text-muted-foreground">
          {blind && revealed && choice
            ? `X was ${refs[order[0]].label}; Y was ${refs[order[1]].label}. You chose ${choice === "same" ? "about the same" : `${choice === order[0] ? "X" : "Y"} (${refs[choice].label})`}.`
            : save.isSuccess
              ? sameSession
                ? "Saved with the session as your own judgement."
                : "Saved as your own judgement, separate from any measures."
              : ""}
        </p>
        {save.error && <p role="alert" className="text-meta text-destructive">{save.error.message}</p>}
      </fieldset>

      {hidden ? (
        <p className="text-meta text-muted-foreground">Measures side by side appear after you reveal.</p>
      ) : (
        <details className="border-t pt-2">
          <summary className="flex min-h-9 cursor-pointer items-center justify-between gap-2 font-medium">
            Measures side by side <EvidenceLabel source="estimated" />
          </summary>
          <table className="mt-2 w-full text-left">
            <thead className="text-meta text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 font-medium">Measure</th>
                <th scope="col" className="py-1 text-right font-medium">A</th>
                <th scope="col" className="py-1 text-right font-medium">B</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(rows[0] ?? rows[1] ?? []).map(([label], i) => (
                <tr key={label}>
                  <th scope="row" className="py-1.5 font-normal">{label}</th>
                  <td className="py-1.5 text-right tabular-nums">{rows[0]?.[i][1] ?? "not transcribed"}</td>
                  <td className="py-1.5 text-right tabular-nums">{rows[1]?.[i][1] ?? "not transcribed"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows[0] && !rows[1] && <p className="text-meta text-muted-foreground">Neither take is transcribed yet.</p>}
          <p className="mt-1 text-meta text-muted-foreground">Differences are descriptive; neither direction is better by itself.</p>
        </details>
      )}
    </Panel>
  );
}
