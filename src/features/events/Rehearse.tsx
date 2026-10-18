import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { LoadingBlock, Page, Panel, QueryView, SectionTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { useAutoTranscribe } from "@/features/practice/auto-transcribe";
import { useRecorder } from "@/features/practice/recorder";
import { RecorderPanel, useRecorderGuard } from "@/features/practice/RecorderPanel";
import { formatClock } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import type { PracticeContext } from "@/lib/ipc/client";
import { keys, usePreferences, useTalk } from "@/lib/ipc/queries";
import type { RehearsalReport as Report, TakeMark, TalkView } from "@/lib/ipc/schemas";
import { CueCardDeck } from "./CueCards";
import { RehearsalReport } from "./RehearsalReport";

/** The exercise of every rehearsal session (14.3). */
export const REHEARSAL_EXERCISE = "ex-rehearsal";

/** A talk's seed for the run's settings (7.3): its ID, as letters, digits and hyphens. */
const seedFor = (talkId: string) => talkId.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64) || "talk";

function Rehearsal({ talk }: { talk: TalkView }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const [search] = useSearchParams();
  const eventId = search.get("event");
  const native = ipc.recordingMode === "native";
  const { preferences } = usePreferences();
  // One session per sitting: each take in it is one rehearsal of the talk.
  const [sessionId] = useState(() => crypto.randomUUID());
  const [index, setIndex] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const marks = useRef<TakeMark[]>([]);
  const context: PracticeContext = {
    sessionId,
    exerciseId: REHEARSAL_EXERCISE,
    exerciseVersion: 1,
    exerciseType: "rehearsal",
    prompt: talk.talk.title,
    outline: { point: "", reason: "", example: "" },
    conditions: { familiarity: "familiar", preparationSeconds: 0, targetSeconds: Math.min(3600, Math.max(1, talk.targetSeconds)), audience: null, followUp: false },
    activity: { version: 1, seed: seedFor(talk.talk.id), groupId: talk.talk.id, params: { talkId: talk.talk.id } },
  };
  const rec = useRecorder(talk.talk.title, context);
  const guard = useRecorderGuard(rec);
  useAutoTranscribe(rec.takes.map((t) => t.asset.assetId), sessionId, { enabled: preferences.autoTranscribe });

  // Moving to a card while recording marks where its section starts (section 1 starts at 0).
  const go = (next: number) => {
    setIndex(next);
    const sectionId = talk.sections[next]?.id;
    if (rec.phase === "recording" && next > 0 && sectionId && !marks.current.some((m) => m.data.sectionId === sectionId)) {
      marks.current.push({ atMs: Math.max(0, Math.round(rec.elapsedMs)), kind: "section_mark", data: { sectionId } });
    }
  };

  // A saved take: write its marks once, link it to the talk with the sections as they are now, and show the report.
  const seen = useRef(rec.takes.length);
  useEffect(() => {
    if (rec.takes.length <= seen.current) return;
    seen.current = rec.takes.length;
    const take = rec.takes[rec.takes.length - 1];
    const pending = marks.current;
    marks.current = [];
    setFailed(null);
    void (async () => {
      try {
        if (pending.length > 0) await ipc.addTakeEvents(take.asset.attemptId, pending);
        setReport(await ipc.recordRehearsal(talk.talk.id, take.asset.attemptId));
        await Promise.all([
          qc.invalidateQueries({ queryKey: keys.rehearsals(talk.talk.id) }),
          qc.invalidateQueries({ queryKey: keys.talk(talk.talk.id) }),
          qc.invalidateQueries({ queryKey: keys.realEvents }),
        ]);
      } catch (e) {
        setFailed(e instanceof Error ? e.message : "The rehearsal couldn't be added to the talk.");
      }
    })();
  }, [rec.takes.length]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-meta text-muted-foreground">Rehearsal · target {formatClock(talk.targetSeconds * 1000)}</p>
          <h1 className="text-title font-semibold tracking-tight">{talk.talk.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild><Link to={`/events/talks/${talk.talk.id}`}>Outline</Link></Button>
          {eventId && <Button variant="outline" asChild><Link to={`/events/${eventId}`}>Back to the event</Link></Button>}
        </div>
      </header>
      {!native && (
        <p role="note" className="flex items-center gap-2 text-meta text-muted-foreground">
          <Info aria-hidden className="size-4 shrink-0" /> Browser preview: recording is simulated.
        </p>
      )}
      <p className="text-muted-foreground">Record, then move to the next card as you reach each section. The report shows the time per section.</p>
      <CueCardDeck sections={talk.sections} index={index} onIndex={go} />
      <div className="sticky bottom-0 z-10 bg-background/95 pb-2 backdrop-blur">
        <RecorderPanel
          rec={rec}
          compact
          onBeforeStart={() => {
            setIndex(0);
            marks.current = [];
          }}
          labels={{ record: "Start rehearsing", again: "Rehearse again" }}
        />
      </div>
      {failed && <p role="alert" className="text-meta text-destructive">{failed}</p>}
      {report && (
        <Panel aria-labelledby="rehearsal-report">
          <SectionTitle id="rehearsal-report" action={<Button size="sm" variant="ghost" asChild><Link to={`/events/talks/${talk.talk.id}/reports`}>All reports</Link></Button>}>
            This rehearsal
          </SectionTitle>
          <RehearsalReport report={report} />
        </Panel>
      )}
      {guard}
    </div>
  );
}

/**
 * Rehearse a talk (roadmap 14.3): cue cards with the recorder docked below.
 * The take is a rehearsal (exercise type `rehearsal`, grouped by the talk);
 * moving to the next card while recording writes a section mark, and once the
 * take is saved its report shows.
 */
export function RehearsePage() {
  const { talkId } = useParams();
  const talk = useTalk(talkId);
  return (
    <Page className="max-w-5xl">
      <QueryView query={talk} loading={<LoadingBlock rows={4} label="Loading the talk" />}>
        {(t) => <Rehearsal key={t.talk.id} talk={t} />}
      </QueryView>
    </Page>
  );
}
