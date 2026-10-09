import type { ReactNode } from "react";
import { NavLink, useParams } from "react-router";
import { useTheme, type ThemePreference } from "@/app/theme";
import { Page, PageHeader, Panel } from "@/components/page";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useQuery } from "@tanstack/react-query";
import { useIpc } from "@/lib/ipc";
import { formatClock } from "@/lib/format";
import { useInputDevices, usePreferences } from "@/lib/ipc/queries";
import type { CoachingModel, Preferences } from "@/lib/ipc/schemas";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { BackupSettings } from "./BackupSettings";
import { DataFolder } from "./DataFolder";
import { TranscriptionSetup } from "./TranscriptionSetup";
import { TranscriptionMode } from "./TranscriptionMode";
import { MicrophoneTest } from "./MicrophoneTest";
import { ApiTranscriptionTest } from "./ApiTranscriptionTest";
import { ApiCredentialSettings } from "./ApiCredentialSettings";
import { ApiBudgetStatus } from "./ApiBudgetStatus";
import { COACHING_MODELS, CoachingSpike } from "./CoachingSpike";

const SECTIONS = [
  { id: "audio", label: "Audio" },
  { id: "practice", label: "Practice" },
  { id: "appearance", label: "Appearance" },
  { id: "transcription", label: "Transcription" },
  { id: "coaching", label: "Coaching" },
  { id: "data", label: "Data and backups" },
  { id: "about", label: "About" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsPage() {
  const { section } = useParams();
  const current: SectionId = SECTIONS.some((s) => s.id === section) ? (section as SectionId) : "audio";

  return (
    <Page>
      <PageHeader title="Settings" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="min-w-0">
          <ul className="flex gap-1 overflow-x-auto md:flex-col">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <NavLink
                  to={`/settings/${s.id}`}
                  className={cn(
                    "block rounded-md px-3 py-2 whitespace-nowrap hover:bg-secondary",
                    s.id === current && "bg-secondary font-medium",
                  )}
                  aria-current={s.id === current ? "page" : undefined}
                >
                  {s.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 max-w-2xl space-y-6">
          {current === "audio" && <AudioSettings />}
          {current === "practice" && <PracticeSettings />}
          {current === "appearance" && <AppearanceSettings />}
          {current === "transcription" && <TranscriptionSettings />}
          {current === "coaching" && <CoachingSettings />}
          {current === "data" && <DataSettings />}
          {current === "about" && <AboutSettings />}
        </div>
      </div>
    </Page>
  );
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Panel>
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-1 text-meta text-muted-foreground">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </Panel>
  );
}

function SwitchRow({ id, label, hint, ...props }: { id: string; label: string; hint?: string } & React.ComponentProps<typeof Switch>) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="text-meta text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} {...props} />
    </div>
  );
}

function AudioSettings() {
  const devices = useInputDevices();
  const { preferences, update } = usePreferences();
  const list = devices.data ?? [];
  const saved = list.find((d) => d.id === preferences.inputDeviceId && d.available)?.id;
  const selected = saved || list.find((d) => d.isDefault)?.id || "";

  return (
    <Section title="Microphone" description="The microphone is on only during a test or a recording.">
      <div className="space-y-1">
        <Label htmlFor="mic">Input device</Label>
        <div className="flex items-center gap-2">
          <Select value={selected} onValueChange={(id) => update({ inputDeviceId: list.find((d) => d.id === id)?.isDefault ? null : id })} disabled={devices.isPending}>
            <SelectTrigger id="mic" className="min-w-0 flex-1">
              <SelectValue placeholder={devices.isPending ? "Looking for devices…" : "No microphone found"} />
            </SelectTrigger>
            <SelectContent>
              {list.map((d) => (
                <SelectItem key={d.id} value={d.id} disabled={!d.available}>
                  {d.name}
                  {d.isDefault && " (system default)"}
                  {!d.available && " · unavailable"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" title="Refresh microphones" aria-label={devices.isFetching ? "Looking for microphones…" : "Refresh microphones"} disabled={devices.isFetching} onClick={() => void devices.refetch()}>
            <RefreshCw aria-hidden className={devices.isFetching ? "animate-spin" : undefined} />
          </Button>
        </div>
        {preferences.inputDeviceId && !saved && devices.isSuccess && (
          <p className="text-meta text-muted-foreground">The microphone you chose isn't connected, so the Windows default is used.</p>
        )}
        {devices.error && <p role="alert" className="text-meta text-destructive">{devices.error.message}</p>}
      </div>
      <MicrophoneTest deviceId={selected || null} />
      <SwitchRow id="rec-sounds" label="Recording sounds" hint="A short tone when recording starts and stops." checked={preferences.recordingSounds} onCheckedChange={(on) => update({ recordingSounds: on })} />
    </Section>
  );
}

function PracticeSettings() {
  const { preferences, update } = usePreferences();
  return (
    <>
      <Section title="Sessions">
        <div className="space-y-1">
          <Label htmlFor="default-length">Default session length</Label>
          <Select value={preferences.sessionLength} onValueChange={(v) => update({ sessionLength: v as Preferences["sessionLength"] })}>
            <SelectTrigger id="default-length" className="h-10 w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">About 13 minutes</SelectItem>
              <SelectItem value="short">About 5 minutes</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <SwitchRow id="reminders" label="Daily reminder" hint="Only while the app is open. No penalty for skipped days." />
        <SwitchRow id="rec-shortcuts" label="Recording keyboard shortcuts" hint="Ctrl+Enter starts or stops a take in the studio." checked={preferences.recordingShortcuts} onCheckedChange={(on) => update({ recordingShortcuts: on })} />
      </Section>
      <Section title="Languages" description="The interface language and the language you practise are set separately.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ui-lang">Interface language</Label>
            <Select defaultValue="en">
              <SelectTrigger id="ui-lang" className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="en">English</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="practice-lang">Practice language</Label>
            <Select defaultValue="en">
              <SelectTrigger id="practice-lang" className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="en">English</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
      </Section>
    </>
  );
}

function AppearanceSettings() {
  const theme = useTheme();
  return (
    <Section title="Appearance">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Theme</legend>
        <RadioGroup value={theme.preference} onValueChange={(v) => theme.setPreference(v as ThemePreference)} className="gap-2">
          {(
            [
              ["system", "Match Windows"],
              ["light", "Light"],
              ["dark", "Dark"],
            ] as const
          ).map(([value, label]) => (
            <Label key={value} htmlFor={`theme-${value}`} className="flex items-center gap-2 font-normal">
              <RadioGroupItem id={`theme-${value}`} value={value} /> {label}
            </Label>
          ))}
        </RadioGroup>
      </fieldset>
      <SwitchRow
        id="reduced-motion"
        label="Reduce motion"
        hint="Turns off panel transitions. Windows' own setting is always respected."
        checked={theme.reducedMotion}
        onCheckedChange={theme.setReducedMotion}
      />
      <p className="text-meta text-muted-foreground">Text size follows the app zoom (Ctrl + and Ctrl −), up to 200%.</p>
    </Section>
  );
}

function TranscriptionSettings() {
  return (
    <>
      <Section title="Default transcription" description="How new takes are transcribed. You can switch on any take.">
        <TranscriptionMode />
      </Section>
      <Section title="Local Whisper" description="Speech is transcribed on this computer. Audio is never uploaded.">
        <TranscriptionSetup />
      </Section>
      <Section title="Acceleration" description="CUDA was selected after benchmarking the original laptop. Recheck hardware on another computer.">
        <RadioGroup defaultValue="cuda" disabled className="gap-2">
          {(
            [
              ["auto", "No automatic fallback"],
              ["cpu", "CPU"],
              ["cuda", "NVIDIA GPU"],
            ] as const
          ).map(([v, l]) => (
            <Label key={v} htmlFor={`accel-${v}`} className="flex items-center gap-2 font-normal">
              <RadioGroupItem id={`accel-${v}`} value={v} /> {l}
            </Label>
          ))}
        </RadioGroup>
      </Section>
      <Section title="Cloud API keys and test" description="Keys for cloud transcription. Both providers keep fillers and return word timings (D-21).">
        <ApiTranscriptionTest />
      </Section>
    </>
  );
}

function CoachingSettings() {
  const { preferences, update } = usePreferences();
  const mode = preferences.coachingMode;
  return (
    <>
      <Section
        title="Coaching provider"
        description="Independent of transcription. Switching never uploads audio or downloads a model, and nothing is sent until you approve a preview."
      >
        <RadioGroup value={mode} onValueChange={(v) => update({ coachingMode: v as "api" | "off" })} className="gap-3">
          {(
            [
              ["api", "API", "Your own OpenAI account. A take's transcript text and measures leave this computer only when you press Send on a preview.", false],
              ["local_llm", "Local LLM", "A server you run yourself on this computer (loopback only). Not available yet.", true],
              ["off", "Off", "No text is sent anywhere and AI feedback is hidden. Playback, transcripts and your own review still work.", false],
            ] as const
          ).map(([v, l, hint, disabled]) => (
            <Label key={v} htmlFor={`mode-${v}`} className={cn("flex items-start gap-3 font-normal", disabled && "opacity-60")}>
              <RadioGroupItem id={`mode-${v}`} value={v} className="mt-1" disabled={disabled} />
              <span>
                <span className="block font-medium">{l}</span>
                <span className="block text-meta text-muted-foreground">{hint}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </Section>

      {mode === "api" && (
        <Section title="API connection" description="Requests may be billed by OpenAI. Their data-retention terms apply to text you send; provider storage is switched off on every request.">
          <div className="space-y-1">
            <Label htmlFor="coaching-default-model">Default model</Label>
            <Select value={preferences.coachingModel} onValueChange={(v) => update({ coachingModel: v as CoachingModel })}>
              <SelectTrigger id="coaching-default-model" className="h-10 w-full max-w-md"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COACHING_MODELS.map((m) => <SelectItem key={m.id} value={m.id}>{m.label} · {m.note}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-meta text-muted-foreground">Preselected on each request; you can change it there.</p>
          </div>
          <SwitchRow
            id="delivery-impressions"
            label="Delivery impressions (experimental)"
            hint="Off by default. When on, feedback may say how parts of a take may come across to a listener, citing measured pitch, loudness and pace. Never your feelings, never a score."
            checked={preferences.deliveryImpressions}
            onCheckedChange={(on) => update({ deliveryImpressions: on })}
          />
          <ApiCredentialSettings />
          <ApiBudgetStatus />
          <p className="text-meta text-muted-foreground">Warning at USD 4.00 and stop at USD 5.00 a month, shared with cloud transcription (fixed in this version).</p>
          <CoachingSpike />
        </Section>
      )}
    </>
  );
}

/** Real totals from the saved recordings; nothing is shown as zero when unknown. */
function RecordingTotals() {
  const ipc = useIpc();
  const native = ipc.recordingMode === "native";
  const takes = useQuery({ queryKey: ["recordings"], queryFn: () => ipc.listRecordings(), enabled: native });
  if (!native) return <>Available in the desktop app</>;
  if (takes.isPending) return <>Counting…</>;
  if (takes.error || !takes.data) return <>Unavailable: {takes.error?.message ?? "the recording library could not be read"}</>;
  const total = takes.data.reduce((sum, t) => sum + t.durationMs, 0);
  return <>{takes.data.length} saved {takes.data.length === 1 ? "take" : "takes"} · {formatClock(total)} of audio (Trash excluded)</>;
}

function DataSettings() {
  return (
    <>
      <Section title="Storage" description="Recordings, transcripts, and notes stay on this computer, in the data folder below.">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
          <dt className="text-muted-foreground">Data folder</dt>
          <dd><DataFolder /></dd>
          <dt className="text-muted-foreground">Recordings</dt>
          <dd><RecordingTotals /></dd>
        </dl>
      </Section>
      <Section
        title="Backups"
        description="A backup on another drive protects against drive failure. A copy on the same drive doesn't. API keys are never included."
      >
        <BackupSettings />
        <p className="text-meta text-muted-foreground">To export one session as readable files (Markdown notes, CSV measurements, original WAV), open it and choose Export.</p>
      </Section>
    </>
  );
}

function AboutSettings() {
  return (
    <Section title="About ClearPractice">
      <p>Version 0.1.0 · development preview</p>
      <p className="text-muted-foreground">
        A practice aid, not an assessment. It doesn't award proficiency levels, and automatic observations are estimates
        you can inspect and correct.
      </p>
      <p className="text-meta text-muted-foreground">
        No analytics, no account, and no network use except what you explicitly ask for.
      </p>
    </Section>
  );
}
