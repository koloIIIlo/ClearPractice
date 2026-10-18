import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Heart, Pause, Play } from "lucide-react";
import { EmptyState, LoadingBlock } from "@/components/page";
import { Button } from "@/components/ui/button";
import { formatClock, formatDay } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { keys, usePreferences } from "@/lib/ipc/queries";
import type { Moment } from "@/lib/ipc/schemas";
import { weekStart } from "@/lib/engagement/weekly";
import { toLocalDate } from "@/lib/phrase-schedule";
import { cn } from "@/lib/utils";

/** The reel's length: each sentence from its stored start to end. */
export const reelMs = (moments: readonly Moment[]) => moments.reduce((n, m) => n + Math.max(0, m.endMs - m.startMs), 0);

/**
 * Your best moments this week (roadmap 12.5): up to three of your own
 * sentences to replay, the ones you liked first. Seeing yourself succeed
 * builds confidence (Dowrick 1999; Bandura 1977). Each sentence plays from its
 * stored segment times; nothing is cut at manufactured word times (§11).
 */
export function BestMoments() {
  const ipc = useIpc();
  const { preferences } = usePreferences();
  const week = weekStart(toLocalDate(new Date()), preferences.weekStartsOn);
  const moments = useQuery({ queryKey: keys.bestMoments(week), queryFn: () => ipc.bestMoments(week) });
  const list = moments.data ?? [];
  const urls = useQueries({
    queries: [...new Set(list.map((m) => m.attemptId))].map((id) => ({ queryKey: ["recording-playback", id], queryFn: () => ipc.getRecordingPlaybackUrl(id), retry: false })),
  });
  const urlOf = new Map([...new Set(list.map((m) => m.attemptId))].map((id, i) => [id, urls[i]?.data]));
  const audio = useRef<HTMLAudioElement>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [reel, setReel] = useState(false);
  const pending = useRef<number | null>(null);

  const play = (i: number, asReel: boolean) => {
    const el = audio.current;
    const url = urlOf.get(list[i]?.attemptId ?? "");
    if (!el || !url) return;
    setReel(asReel);
    setCurrent(i);
    if (el.getAttribute("src") !== url) {
      pending.current = i;
      el.setAttribute("src", url);
      el.load();
      return;
    }
    el.currentTime = list[i].startMs / 1000;
    void el.play().catch(() => setCurrent(null));
  };
  const stop = () => {
    audio.current?.pause();
    setCurrent(null);
  };
  useEffect(() => () => audio.current?.pause(), []);

  if (moments.isPending) return <LoadingBlock rows={2} label="Loading your best moments" />;
  if (moments.error) return <p role="alert" className="text-meta text-destructive">{moments.error.message}</p>;
  if (list.length === 0)
    return (
      <EmptyState title="No moments yet this week">
        Your best sentences of the week appear here once you have transcribed takes. Like a sentence in a transcript to put it first.
      </EmptyState>
    );
  const playable = list.every((m) => !!urlOf.get(m.attemptId));
  return (
    <div className="space-y-3">
      <audio
        ref={audio}
        hidden
        preload="metadata"
        onLoadedMetadata={(e) => {
          const i = pending.current;
          pending.current = null;
          if (i === null) return;
          e.currentTarget.currentTime = list[i].startMs / 1000;
          void e.currentTarget.play().catch(() => setCurrent(null));
        }}
        onTimeUpdate={(e) => {
          if (current === null) return;
          if (e.currentTarget.currentTime * 1000 >= list[current].endMs) {
            if (reel && current < list.length - 1) play(current + 1, true);
            else stop();
          }
        }}
        onEnded={stop}
      />
      <div className="flex flex-wrap items-center gap-3">
        {current !== null && reel ? (
          <Button onClick={stop}><Pause aria-hidden /> Stop the reel</Button>
        ) : (
          <Button disabled={!playable} onClick={() => play(0, true)}>
            <Play aria-hidden /> Play the reel ({formatClock(reelMs(list))})
          </Button>
        )}
        {!playable && <span className="text-meta text-muted-foreground">The reel plays your recordings in the desktop app.</span>}
      </div>
      <ol className="space-y-2" aria-label="Your best moments this week">
        {list.map((m, i) => (
          <li key={`${m.revisionId}-${m.segment}`} aria-current={current === i ? "true" : undefined} className={cn("rounded-lg border px-3 py-2", current === i && "border-primary bg-secondary/60")}>
            <p className="text-lg">“{m.text}”</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
              {m.liked ? (
                <span className="inline-flex items-center gap-1 text-primary"><Heart aria-hidden className="size-3.5 fill-current" /> You liked this</span>
              ) : (
                <span>Picked: a complete sentence with no hesitation candidate</span>
              )}
              <span>{formatDay(m.localDate)}</span>
              <Button variant="ghost" size="sm" disabled={!urlOf.get(m.attemptId)} onClick={() => (current === i && !reel ? stop() : play(i, false))}>
                <Play aria-hidden /> Listen
              </Button>
              <Link className="text-primary underline underline-offset-2 hover:no-underline" to={`/sessions/${m.sessionId}/attempt/${m.ordinal}`}>Open take</Link>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-meta text-muted-foreground">Picked by simple rules: complete sentences without hesitation candidates; sentences you liked come first.</p>
    </div>
  );
}
