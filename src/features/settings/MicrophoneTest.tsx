import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { LiveWaveform, LEVEL_HISTORY, levelToHeight } from "@/components/live-waveform";
import { Button } from "@/components/ui/button";
import { useIpc } from "@/lib/ipc";
import { AudioPlayer } from "@/components/audio-player";

type Phase = "idle" | "recording" | "done" | "error";
/** Below about −32 dBFS peak, speech is hard to transcribe reliably. */
const QUIET = 0.36;

/**
 * Records five seconds and plays them back (plan 2.12, onboarding step 2).
 * The clip stays in a temporary folder and never enters session history.
 */
export function MicrophoneTest({ deviceId }: { deviceId: string | null }) {
  const ipc = useIpc();
  const [phase, setPhase] = useState<Phase>("idle");
  const [levels, setLevels] = useState<number[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<string | null>(null);
  const native = ipc.recordingMode === "native";

  useEffect(() => {
    let disposed = false;
    let remove: (() => void) | undefined;
    void ipc
      .onMicTestEvent(
        (status) => {
          if (status.attemptId === attempt.current && status.phase === "recording" && status.monotonicMs > 0)
            setLevels((prev) => [...prev, status.level].slice(-LEVEL_HISTORY));
        },
        (result) => {
          if (result.attemptId !== attempt.current) return;
          if (result.error) {
            setError(result.error);
            setPhase("error");
            return;
          }
          ipc
            .getMicTestPlaybackUrl(result.attemptId)
            .then((next) => {
              setUrl(next);
              setPhase("done");
            })
            .catch((e: unknown) => {
              setError(e instanceof Error ? e.message : "The test clip could not be opened.");
              setPhase("error");
            });
        },
      )
      .then((unsubscribe) => (disposed ? unsubscribe() : (remove = unsubscribe)))
      .catch(() => {});
    return () => {
      disposed = true;
      remove?.();
    };
  }, [ipc]);

  const start = async () => {
    setLevels([]);
    setUrl(null);
    setError(null);
    setPhase("recording");
    try {
      const status = await ipc.startMicTest(deviceId);
      attempt.current = status.attemptId;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The microphone could not be opened.");
      setPhase("error");
    }
  };

  const peak = levels.length ? Math.max(...levels.map(levelToHeight)) : 0;
  return (
    <div className="space-y-3">
      <Button variant="outline" disabled={!native || phase === "recording"} onClick={() => void start()}>
        <Mic aria-hidden /> {phase === "recording" ? "Recording 5 seconds…" : phase === "done" ? "Test again" : "Test microphone"}
      </Button>
      {!native && <p className="text-meta text-muted-foreground">The microphone test runs in the desktop app.</p>}
      {phase === "recording" && (
        <>
          <p role="status" className="text-meta text-muted-foreground">Say a sentence in your normal speaking voice.</p>
          <LiveWaveform levels={levels} level={levels.at(-1) ?? 0} active clipping={false} />
        </>
      )}
      {phase === "done" && url && (
        <div className="space-y-2">
          <AudioPlayer src={url} label="the microphone test recording" className="max-w-xl" />
          <p role="status" className="text-meta">
            {peak < QUIET
              ? "This sounds very quiet. Move closer to the microphone or raise its input volume in Windows sound settings, then test again."
              : "Your voice came through clearly. Listen back to check for noise or distortion."}
          </p>
          <p className="text-meta text-muted-foreground">The test clip is temporary and isn't saved to your sessions.</p>
        </div>
      )}
      {phase === "error" && error && <p role="alert" className="text-meta text-destructive">{error}</p>}
    </div>
  );
}
