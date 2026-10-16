import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQueries } from "@tanstack/react-query";
import { ListVideo } from "lucide-react";
import { EvidenceLabel } from "@/components/evidence";
import { PageHeader, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useIpc } from "@/lib/ipc";
import type { AttemptTranscript, SessionDetail } from "@/lib/ipc/schemas";
import { formatClock } from "@/lib/format";
import { NativeTake } from "@/features/sessions/NativeSession";
import { AbListen } from "@/features/insights/AbListen";
import { EarlierAnswers } from "@/features/insights/CrossComparePage";
import { createPlayerLink, type PlayerLink } from "./player-link";

type Row = { label: string; source: "measured" | "estimated"; value: (t: Take) => string };
type Take = { ordinal: number; durationMs: number; transcript: AttemptTranscript | undefined };

/** A measure, or why it is unavailable (never 0). */
function measures(t: AttemptTranscript | undefined) {
  const r = t?.revision;
  if (!r) return null;
  const voice = r.measures.voice && !r.measures.voice.unavailableReason ? r.measures.voice.pauses : null;
  return {
    words: r.measures.wordCount,
    pace: r.measures.paceWpm,
    paceWhy: r.measures.paceUnavailableReason,
    pauses: voice ?? (r.measures.pausesUnavailableReason ? null : r.measures.pauses),
    fillers: r.measures.fillers.filter((f) => f.decision !== "dismissed").length,
  };
}

const ROWS: Row[] = [
  { label: "Duration", source: "measured", value: (t) => formatClock(t.durationMs) },
  { label: "Words", source: "estimated", value: (t) => { const m = measures(t.transcript); return m ? String(m.words) : "Not transcribed"; } },
  { label: "Pace", source: "estimated", value: (t) => { const m = measures(t.transcript); return !m ? "Not transcribed" : m.pace === null ? "Unavailable" : `${Math.round(m.pace)} wpm`; } },
  { label: "Pauses over 0.7 s", source: "estimated", value: (t) => { const m = measures(t.transcript); return !m ? "Not transcribed" : m.pauses === null ? "Unavailable" : String(m.pauses.length); } },
  { label: "Filler candidates", source: "estimated", value: (t) => { const m = measures(t.transcript); return m ? String(m.fillers) : "Not transcribed"; } },
];

/**
 * Attempt comparison in the desktop app (4.14): two takes side by side, each
 * with its own player and position (starting one pauses the other), an
 * alternating "Play A, then B", A/B listening at the same point (blind if you
 * like, 8.5) with which take felt clearer to you saved as your own judgement,
 * and the measures next to each other.
 */
export function NativeCompare({ session }: { session: SessionDetail }) {
  const ipc = useIpc();
  const takes = session.attempts.filter((a) => !a.audioUnavailableReason);
  const [aId, setA] = useState(takes[0]?.id ?? "");
  const [bId, setB] = useState(takes.at(-1)?.id ?? "");
  const [links] = useState(() => ({ a: createPlayerLink(), b: createPlayerLink() }));
  const [inTurn, setInTurn] = useState(false);
  // While you listen blind (8.5), the take columns and measures would give it away.
  const [hiding, setHiding] = useState(false);
  const pair = [takes.find((t) => t.id === aId), takes.find((t) => t.id === bId)];
  const transcripts = useQueries({
    queries: pair.map((t) => ({ queryKey: ["attempt-transcript", t?.id ?? ""], queryFn: () => ipc.getAttemptTranscript(t!.id), enabled: !!t })),
  });
  // Alternating playback: when A finishes, B starts from its beginning.
  useEffect(() => {
    if (!inTurn) return;
    const stop = links.a.onFinish(() => { setInTurn(false); links.b.seek(0, true); });
    return () => { stop(); };
  }, [inTurn, links]);

  if (takes.length < 2) {
    return (
      <>
        <PageHeader title="Compare takes" description={session.prompt} />
        <Panel><p>Record at least two takes in this session to compare them.</p></Panel>
      </>
    );
  }
  const [a, b] = pair;
  const rows: Take[] = pair.map((t, i) => ({ ordinal: t?.ordinal ?? 0, durationMs: t?.durationMs ?? 0, transcript: transcripts[i].data }));
  const option = (id: string) => takes.map((t) => <option key={t.id} value={t.id} disabled={t.id === id}>Take {t.ordinal} · {formatClock(t.durationMs)}</option>);

  return (
    <div className="space-y-4">
      <PageHeader title="Compare takes" description={session.prompt || session.title} meta={session.focus ? `Your focus: ${session.focus}` : undefined} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="compare-a">First take</Label>
          <NativeSelect id="compare-a" value={aId} onChange={(e) => setA(e.target.value)}>{option(bId)}</NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="compare-b">Second take</Label>
          <NativeSelect id="compare-b" value={bId} onChange={(e) => setB(e.target.value)}>{option(aId)}</NativeSelect>
        </div>
        {!hiding && (
          <Button variant="outline" onClick={() => { setInTurn(true); links.a.seek(0, true); }}>
            <ListVideo aria-hidden /> Play take {a?.ordinal}, then take {b?.ordinal}
          </Button>
        )}
        <Button variant="ghost" asChild><Link to={`/sessions/${session.id}`}>Back to the session</Link></Button>
      </div>

      {a && b && (
        <AbListen
          key={`${a.id}-${b.id}`}
          a={{ attemptId: a.id, sessionId: session.id, label: `Take ${a.ordinal} · ${formatClock(a.durationMs)}` }}
          b={{ attemptId: b.id, sessionId: session.id, label: `Take ${b.ordinal} · ${formatClock(b.durationMs)}` }}
          sessionTitle={session.title}
          onBlindChange={setHiding}
        />
      )}
      <EarlierAnswers session={session} attemptId={b?.id ?? a?.id ?? ""} />

      {hiding ? (
        <p className="text-meta text-muted-foreground">The takes and their measures are hidden while you listen blind. Reveal to see them.</p>
      ) : (
      <>
      <div className="grid gap-4 md:grid-cols-2">
        {pair.map((t, i) => t && (
          <TakeColumn key={`${i}-${t.id}`} title={`Take ${t.ordinal}`} attemptId={t.id} link={i === 0 ? links.a : links.b} transcript={transcripts[i].data} />
        ))}
      </div>

      <Panel>
        <h2 className="mb-1 font-semibold">Side by side</h2>
        <p className="mb-3 text-meta text-muted-foreground">Differences are descriptive. A faster or slower pace isn't automatically better.</p>
        <table className="w-full text-left">
          <thead className="text-meta text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 font-medium">Measure</th>
              <th scope="col" className="py-1 text-right font-medium">Take {rows[0].ordinal}</th>
              <th scope="col" className="py-1 text-right font-medium">Take {rows[1].ordinal}</th>
              <th scope="col" className="py-1 text-right font-medium"><span className="sr-only">Source</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="py-2 font-normal">{row.label}</th>
                <td className="py-2 text-right tabular-nums">{row.value(rows[0])}</td>
                <td className="py-2 text-right tabular-nums">{row.value(rows[1])}</td>
                <td className="py-2 text-right"><EvidenceLabel source={row.source} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      </>
      )}
    </div>
  );
}

function TakeColumn({ title, attemptId, link, transcript }: { title: string; attemptId: string; link: PlayerLink; transcript: AttemptTranscript | undefined }) {
  const text = transcript?.correction?.text ?? transcript?.revision?.text;
  return (
    <Panel className="min-w-0 space-y-3" aria-label={title}>
      <h2 className="font-semibold">{title}</h2>
      <NativeTake assetId={attemptId} link={link} />
      {text ? (
        <div className="space-y-1">
          <p className="text-meta text-muted-foreground">{transcript?.correction ? "Your correction" : "As transcribed"}</p>
          <p className="leading-relaxed">{text}</p>
        </div>
      ) : (
        <p className="text-meta text-muted-foreground">Not transcribed yet. Open the session to transcribe this take.</p>
      )}
    </Panel>
  );
}
