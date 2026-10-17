import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/audio-player";
import { EvidenceLabel } from "@/components/evidence";
import { LoadingBlock } from "@/components/page";
import { Button } from "@/components/ui/button";
import { PHRASE_SAY_IT } from "@/content/exercises";
import { useIpc } from "@/lib/ipc";
import { keys, usePhraseUses, usePracticeFacts, usePreferences } from "@/lib/ipc/queries";
import type { PhraseCard, PracticeFacts } from "@/lib/ipc/schemas";
import { toLocalDate } from "@/lib/phrase-schedule";
import { useAutoTranscribe } from "@/features/practice/auto-transcribe";
import { useRecorder } from "@/features/practice/recorder";
import { RecorderPanel, useRecorderGuard } from "@/features/practice/RecorderPanel";
import { useTranscriptionQueue } from "@/features/transcription/queue";

/** A Say it take stops by itself after this long. */
export const SAY_IT_LIMIT_MS = 20_000;

let remembered: { date: string; id: string } | null = null;

/** Today's Phrase practice session (11.7): one a day, found again through facts, or new on the first take. */
export function phraseSessionId(facts: PracticeFacts, today: string): string {
  const existing = facts.sessions.find((s) => s.exerciseType === PHRASE_SAY_IT.type && s.localDate === today)?.id;
  if (existing) return existing;
  if (remembered?.date !== today) remembered = { date: today, id: crypto.randomUUID() };
  return remembered.id;
}

/** After transcription: whether the phrase turned up in what you said (Estimated). Rating stays yours. */
function SayItResult({ attemptId, phraseId, sessionId }: { attemptId: string; phraseId: string; sessionId: string }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const queue = useTranscriptionQueue();
  const player = useRef<AudioPlayerHandle>(null);
  const transcript = useQuery({ queryKey: ["attempt-transcript", attemptId], queryFn: () => ipc.getAttemptTranscript(attemptId) });
  const playback = useQuery({ queryKey: ["recording-playback", attemptId], queryFn: () => ipc.getRecordingPlaybackUrl(attemptId), retry: false });
  const uses = usePhraseUses(phraseId);
  const revisionId = transcript.data?.revision?.id;
  // Phrases are spotted when the transcript is saved; fetch them again once it is.
  useEffect(() => {
    if (revisionId) void qc.invalidateQueries({ queryKey: keys.phraseUses(phraseId) });
  }, [revisionId, phraseId, qc]);
  const use = uses.data?.find((u) => u.attemptId === attemptId);
  const segment = use && transcript.data?.revision ? transcript.data.revision.segments[use.segment] : undefined;
  const busy = queue.current?.attemptId === attemptId || queue.waiting.some((i) => i.attemptId === attemptId) || transcript.data?.job?.state === "running";
  return (
    <div className="space-y-2" aria-live="polite">
      {playback.data && <AudioPlayer ref={player} src={playback.data} label="your sentence" />}
      {!revisionId ? (
        busy ? (
          <p className="text-meta text-muted-foreground">Transcribing on this computer to look for the phrase…</p>
        ) : queue.available ? (
          <p className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
            Transcribe it to look for the phrase.
            <Button variant="outline" size="sm" onClick={() => queue.enqueue([{ attemptId, sessionId }])}>Transcribe</Button>
          </p>
        ) : (
          <p className="text-meta text-muted-foreground">{queue.unavailableReason ?? "Transcription isn't set up."} You can still rate it.</p>
        )
      ) : use ? (
        <p className="flex flex-wrap items-center gap-2">
          Phrase spotted in your sentence <EvidenceLabel source="estimated" />
          {segment?.startMs != null && (
            <Button variant="ghost" size="sm" onClick={() => player.current?.playRange(segment.startMs!, segment.endMs ?? segment.startMs! + 5_000)}>
              <Play aria-hidden /> Listen
            </Button>
          )}
        </p>
      ) : (
        <p className="text-muted-foreground">Not found; you can still rate it. Matching goes by words, so a different form can be missed.</p>
      )}
    </div>
  );
}

function SayItRecorder({ card, sessionId }: { card: PhraseCard; sessionId: string }) {
  const { preferences } = usePreferences();
  const rec = useRecorder("Phrase practice", {
    sessionId, exerciseId: PHRASE_SAY_IT.id, exerciseVersion: PHRASE_SAY_IT.version, exerciseType: PHRASE_SAY_IT.type,
    prompt: "Say a sentence of your own using a saved phrase", outline: { point: "", reason: "", example: "" },
    conditions: { familiarity: "familiar", preparationSeconds: 0, targetSeconds: SAY_IT_LIMIT_MS / 1000, audience: null, followUp: false },
  });
  const guard = useRecorderGuard(rec);
  useAutoTranscribe(rec.takes.map((t) => t.asset.assetId), sessionId, { enabled: preferences.autoTranscribe });
  // Takes are 20 seconds at most; stop once at the limit.
  const stopped = useRef(false);
  useEffect(() => {
    if (rec.phase !== "recording") {
      stopped.current = false;
      return;
    }
    if (rec.elapsedMs >= SAY_IT_LIMIT_MS && !stopped.current) {
      stopped.current = true;
      void rec.stopAndSave();
    }
  }, [rec.phase, rec.elapsedMs, rec]);
  const last = rec.takes.at(-1);
  return (
    <div className="space-y-3">
      <p>
        Say a sentence of your own using <em className="font-medium not-italic">{card.expression}</em>.
      </p>
      <RecorderPanel rec={rec} compact hideCountdown footer={<p className="text-meta text-muted-foreground">Up to 20 seconds. It stops by itself.</p>} />
      {last && <SayItResult key={last.asset.assetId} attemptId={last.asset.assetId} phraseId={card.id} sessionId={sessionId} />}
      {guard}
    </div>
  );
}

/**
 * Phrases → Say it (roadmap 11.7): say the phrase aloud in a sentence of your
 * own. Producing words aloud helps you remember them (MacLeod et al. 2010).
 * Takes go into today's Phrase practice session; the app can spot the phrase
 * in what you said, but the rating is always yours.
 */
export function PhraseSayIt({ card }: { card: PhraseCard }) {
  const facts = usePracticeFacts();
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    if (facts.data && !sessionId) setSessionId(phraseSessionId(facts.data, toLocalDate(new Date())));
  }, [facts.data, sessionId]);
  if (facts.error) return <p role="alert" className="text-meta text-destructive">{facts.error.message}</p>;
  if (!sessionId) return <LoadingBlock rows={1} label="Opening the recorder" />;
  return <SayItRecorder card={card} sessionId={sessionId} />;
}
