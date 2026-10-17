import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useBlocker } from "react-router";
import { Check, Loader2, Mic, RefreshCw, Square } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/page";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { LiveWaveform, levelToHeight } from "@/components/live-waveform";
import { formatClock } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { useInputDevices, usePreferences } from "@/lib/ipc/queries";
import { LivePaceMeter, useLivePace, useUsualRate } from "@/features/insights/LivePaceMeter";
import { requestEngagementRefresh } from "@/features/engagement/refresh";
import { usePracticeStyle } from "@/features/engagement/style";
import { takeXp } from "@/lib/engagement/xp";
import { toLocalDate } from "@/lib/phrase-schedule";
import { playCue } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { useLevelMonitor } from "./level-monitor";
import type { Recorder } from "./recorder";

/** The microphone in use: your saved choice when it is connected, else the Windows default, else any available one. */
export function useSelectedDevice() {
  const devices = useInputDevices();
  const { preferences, update } = usePreferences();
  const preferred = devices.data?.find((device) => device.id === preferences.inputDeviceId && device.available)?.id;
  const selectedDevice =
    preferred || devices.data?.find((device) => device.isDefault && device.available)?.id || devices.data?.find((device) => device.available)?.id || "";
  const setDeviceId = (id: string) => update({ inputDeviceId: devices.data?.find((d) => d.id === id)?.isDefault ? null : id });
  return { devices, selectedDevice, setDeviceId };
}

export interface RecorderPanelProps {
  /** From useRecorder; the parent keeps it so it can list the takes. */
  rec: Recorder;
  /** Inside the recorder, between the waveform and the button (the Studio's focus; drill clocks later). */
  inside?: ReactNode;
  /** Replaces the clock (drills show a countdown ring). */
  clock?: ReactNode;
  /** Label overrides, e.g. "Start round" instead of "Record". */
  labels?: Partial<{ record: string; again: string; stop: string }>;
  /** Hides the 3-second countdown switch (activities with their own think time). */
  hideCountdown?: boolean;
  /** Called before a take starts, e.g. to set the take's step. */
  onBeforeStart?: () => void;
  /** Replaces the hint line under the controls. */
  footer?: ReactNode;
  /** Shows Record as an outline button while another action is the primary one (a sequence's Next step). */
  deemphasize?: boolean;
  /** data-tour value of the button. */
  tourId?: string;
  /** Show the live pace meter whatever the setting (an activity that needs it, e.g. the pace ladder). */
  livePace?: boolean;
}

/**
 * The recorder (roadmap 7.9): status, clock, live waveform, Record or Stop with
 * the level halo, microphone choice, countdown, Ctrl+Enter and the spoken
 * state changes. Shared by the Studio and every later activity, so each gets
 * the same audio safety.
 */
export function RecorderPanel({ rec, inside, clock, labels, hideCountdown, onBeforeStart, footer, deemphasize, tourId, livePace }: RecorderPanelProps) {
  const ipc = useIpc();
  const native = ipc.recordingMode === "native";
  const { preferences } = usePreferences();
  const { devices, selectedDevice, setDeviceId } = useSelectedDevice();
  const [useCountdown, setUseCountdown] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const takeNumber = rec.takes.length + (rec.phase === "saved" || rec.phase === "interrupted" ? 0 : 1);
  // Live pace (8.8): from Settings, or forced by an activity.
  const showPace = livePace ?? preferences.livePace;
  const { playful } = usePracticeStyle();
  const pace = useLivePace(showPace && rec.phase === "recording");
  const usual = useUsualRate(showPace);
  const lastTake = rec.takes[rec.takes.length - 1];

  // Screen-reader announcements for state changes only — never every timer second (§14).
  useEffect(() => {
    const text: Partial<Record<typeof rec.phase, string>> = {
      countdown: "Get ready. Recording starts after the countdown.",
      recording: `Recording take ${takeNumber}.`,
      finalizing: "Saving the take.",
      saved: lastTake ? `Take ${lastTake.ordinal} ${native ? "saved" : "simulated"}.` : "",
      interrupted: rec.error ?? "The take was interrupted.",
    };
    setAnnouncement(text[rec.phase] ?? "");
    if (preferences.recordingSounds && native) {
      if (rec.phase === "preparing") playCue("start");
      if (rec.phase === "saved") playCue("stop");
    }
    if (rec.phase === "saved" && lastTake) {
      const text = `Take ${lastTake.ordinal} ${native ? "saved" : "simulated"}`;
      // Playful style adds the take's XP to the same toast (9.5); without it, no suffix.
      if (!playful) toast.success(text);
      else
        void ipc
          .listPracticeEvents(toLocalDate(new Date()))
          .then((events) => takeXp(events, lastTake.asset.assetId))
          .catch(() => 0)
          .then((xp) => toast.success(xp > 0 ? `${text} · +${xp} XP` : text));
      requestEngagementRefresh("take");
    }
  }, [rec.phase]);

  const primary = () => {
    if (rec.phase === "recording") void rec.stopAndSave();
    else if (rec.phase === "countdown") rec.cancelCountdown();
    else if (!rec.isCapturing) {
      onBeforeStart?.();
      rec.start({ countdownSeconds: useCountdown && !hideCountdown ? 3 : 0, deviceId: selectedDevice || null, livePace: showPace });
    }
  };

  // Ctrl+Enter records or stops anywhere on the page, not only when focus is
  // inside the recorder (§14). Open dialogs keep their own keyboard handling.
  const primaryRef = useRef(primary);
  primaryRef.current = primary;
  const shortcuts = preferences.recordingShortcuts;
  const canUsePrimary = rec.ready && rec.phase !== "preparing" && rec.phase !== "finalizing" && (rec.isCapturing || !!selectedDevice);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!shortcuts) return;
      if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter" || e.repeat || e.defaultPrevented) return;
      if (document.querySelector("[role=alertdialog], [role=dialog]")) return;
      if (!canUsePrimary) return;
      e.preventDefault();
      primaryRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canUsePrimary, shortcuts]);

  const locked = rec.isCapturing || rec.phase === "countdown";
  // Live level before a take (nothing is recorded); released as soon as a take starts.
  const monitoring = preferences.levelBeforeRecording && rec.ready && !rec.isCapturing && !!selectedDevice;
  const monitor = useLevelMonitor(selectedDevice || null, monitoring);

  return (
    <>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <Panel className="flex flex-col items-center gap-4 py-8">
        <RecorderStatus rec={rec} />
        {clock ?? (
          <div className="text-5xl font-semibold tracking-tight tabular-nums" aria-label="Elapsed time">
            {rec.phase === "countdown" ? rec.countdown : formatClock(rec.elapsedMs)}
          </div>
        )}
        {/* Before a take the meter shows the live microphone level, dimmed; recording brightens it. */}
        {rec.phase !== "recording" && monitoring && monitor.levels.length > 0 ? (
          <LiveWaveform levels={monitor.levels} level={monitor.level} active={false} clipping={false} />
        ) : (
          <LiveWaveform levels={rec.levels} level={rec.level} active={rec.phase === "recording"} clipping={rec.clipping} />
        )}
        {showPace && rec.phase === "recording" && <LivePaceMeter rate={pace} usual={usual} />}
        {inside}
        <Button
          data-tour={tourId}
          size="lg"
          onClick={primary}
          disabled={!canUsePrimary}
          // One solid primary: Stop while recording; otherwise the parent may hand the role to another action.
          variant={rec.phase !== "recording" && deemphasize ? "outline" : "default"}
          className={cn("min-w-44 rounded-full", rec.phase === "recording" && "level-halo")}
          style={rec.phase === "recording" ? ({ "--level": levelToHeight(rec.level) } as CSSProperties) : undefined}
          aria-keyshortcuts="Control+Enter"
        >
          {rec.phase === "recording" ? (
            <>
              <Square aria-hidden className="fill-current" /> {labels?.stop ?? "Stop and save"}
            </>
          ) : rec.phase === "countdown" ? (
            "Cancel countdown"
          ) : rec.phase === "finalizing" || rec.phase === "preparing" ? (
            <>
              <Loader2 aria-hidden className="animate-spin" /> {rec.phase === "preparing" ? "Opening microphone" : "Saving"}
            </>
          ) : (
            <>
              <Mic aria-hidden /> {rec.takes.length ? (labels?.again ?? "Record again") : (labels?.record ?? "Record")}
            </>
          )}
        </Button>
        <div className="flex max-w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 text-meta text-muted-foreground">
          {/* The microphone lives in the recorder, so the page fits on one screen. */}
          <div className="flex min-w-0 items-center gap-1">
            <Label htmlFor="studio-microphone" className="sr-only">Microphone</Label>
            <Select value={selectedDevice} onValueChange={setDeviceId} disabled={locked || devices.isPending}>
              <SelectTrigger id="studio-microphone" size="sm" className="max-w-72 min-w-0 rounded-full">
                <Mic aria-hidden className="text-muted-foreground" />
                <SelectValue placeholder={devices.isPending ? "Looking for microphones…" : "No microphone found"} />
              </SelectTrigger>
              <SelectContent>
                {devices.data?.map((device) => <SelectItem key={device.id} value={device.id} disabled={!device.available}>{device.name}{device.isDefault ? " (system default)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon-sm" className="rounded-full" title="Refresh microphones" aria-label={devices.isFetching ? "Looking for microphones…" : "Refresh microphones"} disabled={locked || devices.isFetching} onClick={() => void devices.refetch()}>
              <RefreshCw aria-hidden className={devices.isFetching ? "animate-spin" : undefined} />
            </Button>
          </div>
          {!hideCountdown && (
            <div className="flex items-center gap-2">
              <Switch id="countdown" checked={useCountdown} onCheckedChange={setUseCountdown} disabled={locked} />
              <Label htmlFor="countdown" className="font-normal">
                3-second countdown
              </Label>
            </div>
          )}
        </div>
        {devices.error && <p role="alert" className="text-meta text-destructive">{devices.error.message}</p>}
        {monitor.error && monitoring && <p className="text-meta text-muted-foreground">Live level unavailable: {monitor.error}</p>}
        {footer ?? (
          <p className="text-meta text-muted-foreground">
            {shortcuts ? "Ctrl+Enter to record or stop. " : ""}The timer is for information only, so there's no need to rush.
          </p>
        )}
      </Panel>
    </>
  );
}

/** Never silently abandon a take (§6 Practice studio): asks before leaving the page or closing the window while recording. */
export function useRecorderGuard(rec: Recorder) {
  const blocker = useBlocker(rec.isCapturing);
  return (
    <AlertDialog open={blocker.state === "blocked" || rec.closeRequested}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>A take is still recording</AlertDialogTitle>
          <AlertDialogDescription>
            Stop and save it before leaving, or keep recording. Leaving never discards audio silently.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => { blocker.reset?.(); rec.continueRecording(); }}>Continue recording</AlertDialogCancel>
          <Button
            disabled={rec.phase === "finalizing"}
            onClick={async () => {
              if (rec.closeRequested) await rec.saveAndClose();
              else if (await rec.stopAndSave()) blocker.proceed?.();
            }}
          >
            Stop and save
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The recorder's state as a small pill; a live dot pulses while recording (still under reduced motion). */
export function RecorderStatus({ rec }: { rec: Recorder }) {
  const quiet = "bg-secondary text-muted-foreground";
  const map = {
    idle: { text: "Ready", tone: quiet },
    countdown: { text: "Get ready. Not recording yet", tone: quiet },
    preparing: { text: "Opening microphone…", tone: quiet },
    recording: { text: "Recording", tone: "bg-destructive/10 text-destructive" },
    finalizing: { text: "Saving…", tone: quiet },
    saved: { text: "Take complete", tone: "bg-primary/10 text-primary" },
    interrupted: { text: "Recording interrupted", tone: "bg-destructive/10 text-destructive" },
  } as const;
  const { text, tone } = map[rec.phase];
  return (
    <p className={cn("inline-flex h-7 items-center gap-2 rounded-full px-3 text-meta font-medium", tone)}>
      {rec.phase === "recording" && (
        <span aria-hidden className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-current" />
        </span>
      )}
      {rec.phase === "saved" && <Check aria-hidden className="size-3.5" />}
      {text}
    </p>
  );
}
