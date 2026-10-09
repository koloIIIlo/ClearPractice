import { useState } from "react";
import { createPlayerLink, type PlayerLink } from "@/features/review/player-link";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, Panel, QueryView } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useIpc } from "@/lib/ipc";
import type { SessionDetail } from "@/lib/ipc/schemas";
import { formatClock, formatLongDay } from "@/lib/format";
import { SavedAudio } from "@/features/practice/RecordingLibrary";
import { MoveTakeToTrashButton, MoveToTrashButton } from "./TrashPage";
import { TakeTranscript } from "@/features/review/TakeTranscript";
import { IntonationTrack } from "@/features/review/IntonationTrack";
import { BookmarkPlus, Columns2, Download } from "lucide-react";
import { PhraseForm } from "@/features/phrases/PhrasesPage";
import { TakeCoaching } from "@/features/review/TakeCoaching";
import { Checkbox } from "@/components/ui/checkbox";

/** Real saved audio never falls through to simulated review or mock observations. */
export function NativeSession({ session, selectedOrdinal }: { session: SessionDetail; selectedOrdinal?: number }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const [title, setTitle] = useState(session.title);
  const [notes, setNotes] = useState(session.notes);
  const [tags, setTags] = useState(session.tags.join(", "));
  const [favorite, setFavorite] = useState(session.favorite);
  const save = useMutation({
    mutationFn: () => ipc.updateSession(session.id, { title, notes, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), favorite }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["sessions"] }); await qc.invalidateQueries({ queryKey: ["session", session.id] }); },
  });
  const exporting = useMutation({ mutationFn: () => ipc.exportSession(session.id) });
  const attempts = selectedOrdinal === undefined ? session.attempts : session.attempts.filter((a) => a.ordinal === selectedOrdinal);
  return <div className="space-y-4">
    <PageHeader
      title={session.title}
      description={`${formatLongDay(session.localDate)} · ${session.attemptCount} saved takes · ${formatClock(session.durationMs)}${session.curriculumVersion ? ` · curriculum v${session.curriculumVersion}` : ""}`}
      actions={session.attempts.length > 1 ? <Button variant="outline" asChild><Link to={`/sessions/${session.id}/compare`}><Columns2 aria-hidden /> Compare takes</Link></Button> : undefined}
    />
    {session.prompt && <Panel><p>{session.prompt}</p></Panel>}
    {session.focus && <p className="text-meta"><span className="text-muted-foreground">Your focus for the retakes:</span> {session.focus}</p>}
    {(session.ease || session.takeaway) && (
      <p className="text-meta">
        <span className="text-muted-foreground">Your reflection:</span>
        {session.ease ? ` felt ${session.ease} of 5 (1 very hard, 5 very easy)` : ""}
        {session.ease && session.takeaway ? " · " : " "}
        {session.takeaway ? `keep for next time: ${session.takeaway}` : ""}
      </p>
    )}
    {session.conditionsUnavailableReason && <p className="text-meta text-muted-foreground">Task conditions unavailable: {session.conditionsUnavailableReason}</p>}
    <p className="text-meta text-muted-foreground">Listen, transcribe a take, review fillers, pauses and intonation, and keep your own notes. AI feedback on a take is optional: you see the exact text before anything is sent, and audio never leaves this computer.</p>
    {attempts.length === 0 && <p role="status">This take is unavailable.</p>}
    {attempts.map((a) => <Panel key={a.id} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Take {a.ordinal} · {formatClock(a.durationMs)} <span className="text-meta font-normal text-muted-foreground">Measured duration</span></h2>
        <div className="ml-auto"><MoveTakeToTrashButton take={a} sessionTitle={session.title} /></div>
      </div>
      {a.audioUnavailableReason ? <p role="alert">Audio unavailable: {a.audioUnavailableReason}</p> : <LinkedTake attemptId={a.id} sessionId={session.id} />}
    </Panel>)}
    <Panel>
      <form className="space-y-4" onChange={() => save.reset()} onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <h2 className="font-semibold">Session details</h2>
        <div className="space-y-2"><Label htmlFor="session-title">Title</Label><Input id="session-title" value={title} maxLength={512} required disabled={save.isPending} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="session-notes">Your note</Label><Textarea id="session-notes" value={notes} maxLength={32768} disabled={save.isPending} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="session-tags">Tags, separated by commas</Label><Input id="session-tags" value={tags} disabled={save.isPending} onChange={(e) => setTags(e.target.value)} /></div>
        <label className="flex min-h-10 items-center gap-2"><Checkbox checked={favorite} disabled={save.isPending} onCheckedChange={(v) => { save.reset(); setFavorite(v === true); }} /> Favorite</label>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save details"}</Button>
        {save.isSuccess && <p role="status" className="text-meta">Session details saved on this computer.</p>}
        {save.error && <p role="alert" className="text-destructive">{save.error.message}</p>}
      </form>
    </Panel>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" asChild><Link to="/sessions">Back to sessions</Link></Button>
      <Button variant="outline" disabled={exporting.isPending} onClick={() => exporting.mutate()}>
        <Download aria-hidden /> {exporting.isPending ? "Exporting…" : "Export…"}
      </Button>
      <MoveToTrashButton session={session} />
    </div>
    <div aria-live="polite">
      {exporting.data && (
        <p role="status" className="text-meta">
          Exported {exporting.data.fileName}: notes, measurements and {exporting.data.recordings} original{" "}
          {exporting.data.recordings === 1 ? "recording" : "recordings"}
          {exporting.data.unavailableRecordings > 0 && ` (${exporting.data.unavailableRecordings} unavailable, listed in the file)`}.
        </p>
      )}
      {exporting.error && <p role="alert" className="text-meta text-destructive">{exporting.error.message}</p>}
    </div>
  </div>;
}
/** Player and intonation share one position, so the pitch view follows playback (P.4). */
function LinkedTake({ attemptId, sessionId }: { attemptId: string; sessionId: string }) {
  const [link] = useState(createPlayerLink);
  return <><NativeTake assetId={attemptId} link={link} /><IntonationTrack attemptId={attemptId} link={link} /><TakeTranscript attemptId={attemptId} link={link} /><SavePhrase sessionId={sessionId} /><TakeCoaching attemptId={attemptId} /></>;
}

/**
 * Save a phrase from this session (4.11, 4.15): selected transcript text, if
 * any, becomes "What you said"; the card links back to the session.
 */
export function SavePhrase({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (open !== null) return <PhraseForm initialOriginal={open} sourceSessionId={sessionId} onDone={() => { setOpen(null); setSaved(true); }} />;
  return (
    <div className="flex flex-wrap items-center gap-2 text-meta">
      <Button
        variant="outline"
        size="sm"
        // Read the selection before the click moves focus away from it.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { setSaved(false); setOpen((window.getSelection()?.toString() ?? "").trim().slice(0, 500)); }}
      >
        <BookmarkPlus aria-hidden /> Save a phrase…
      </Button>
      <span className="text-muted-foreground">{saved ? <>Saved. <Link className="underline" to="/phrases">Open Phrases</Link></> : "Select words in the transcript first to start from them."}</span>
    </div>
  );
}
export function NativeTake({ assetId, link }: { assetId: string; link: PlayerLink }) {
  const ipc = useIpc();
  const recording = useQuery({ queryKey: ["recording", assetId], queryFn: () => ipc.getSavedRecording(assetId), retry: false });
  return <QueryView query={recording}>{(r) => <SavedAudio recording={r} link={link} />}</QueryView>;
}
