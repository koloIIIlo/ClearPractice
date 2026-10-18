import { ContentSettings } from "./ContentSettings";
import { DatabaseHealth } from "./DatabaseHealth";
import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { NavLink, useParams } from "react-router";
import { useTheme, type ThemePreference } from "@/app/theme";
import { Page, PageHeader, Panel } from "@/components/page";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/ui/native-select";
import { useQuery } from "@tanstack/react-query";
import { useIpc } from "@/lib/ipc";
import { formatClock } from "@/lib/format";
import { FIRST_LANGUAGES } from "@/content/first-languages";
import { SurpriseSettings } from "./SurpriseSettings";
import { useInputDevices, usePreferences } from "@/lib/ipc/queries";
import type { CoachingModel, Preferences } from "@/lib/ipc/schemas";
import { Button } from "@/components/ui/button";
import { Compass, Lock, Minus, Plus, RefreshCw, X } from "lucide-react";
import { Link as RouterLink } from "react-router";
import { ACCENTS, unlockedAccents } from "@/lib/engagement/accents";
import { weekStart } from "@/lib/engagement/weekly";
import { toLocalDate } from "@/lib/phrase-schedule";
import { keys as queryKeys } from "@/lib/ipc/queries";
import { WATCH_WORDS } from "@/lib/insights/words";
import { MEASURES_TIMING } from "@/lib/learning/feedback";
import { useTour } from "@/features/tour/tour";
import { setZoomLevel, stepZoom, useZoomLevel, ZOOM_STEPS } from "@/app/zoom";
import { cn } from "@/lib/utils";
import { BackupSettings } from "./BackupSettings";
import { DataFolder } from "./DataFolder";
import { StorageUsage } from "./StorageUsage";
import { DiagnosticReport } from "./DiagnosticReport";
import { Performance } from "./Performance";
import { TranscriptionSetup } from "./TranscriptionSetup";
import { TranscriptionMode } from "./TranscriptionMode";
import { MicrophoneTest } from "./MicrophoneTest";
import { ApiTranscriptionTest } from "./ApiTranscriptionTest";
import { ApiCredentialSettings } from "./ApiCredentialSettings";
import { ApiBudgetStatus } from "./ApiBudgetStatus";
import { CoachingPrices } from "./CoachingPrices";
import { COACHING_MODELS, CoachingSpike } from "./CoachingSpike";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { PartnerSettings } from "@/features/partner/PartnerSettings";

const SECTIONS = [
  { id: "audio", label: "Audio" },
  { id: "practice", label: "Practice" },
  { id: "appearance", label: "Appearance" },
  { id: "transcription", label: "Transcription" },
  { id: "coaching", label: "Coaching" },
  { id: "partner", label: "Partner" },
  { id: "content", label: "Content" },
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
          {current === "content" && <ContentSettings />}
          {current === "audio" && <AudioSettings />}
          {current === "practice" && <PracticeSettings />}
          {current === "appearance" && <AppearanceSettings />}
          {current === "transcription" && <TranscriptionSettings />}
          {current === "coaching" && <CoachingSettings />}
          {current === "partner" && <PartnerSettings />}
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

export function AudioSettings() {
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
      <SwitchRow
        id="live-level"
        label="Show the microphone level before recording"
        hint="In the studio, the waveform reacts to your voice before you press Record. The microphone is only measured: nothing is recorded or kept, and Windows shows it as in use while the studio is open."
        checked={preferences.levelBeforeRecording}
        onCheckedChange={(on) => update({ levelBeforeRecording: on })}
      />
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
        <SwitchRow id="reminders" label="Daily reminder" hint="A gentle reminder at the time below, only while the app is open and only if you haven't practised that day. No penalty for skipped days."
          checked={preferences.reminderTime !== null} onCheckedChange={(on) => update({ reminderTime: on ? "18:00" : null })} />
        {preferences.reminderTime !== null && (
          <div className="flex items-center gap-2 pl-1">
            <Label htmlFor="reminder-time" className="font-normal">Remind me at</Label>
            <NativeSelect id="reminder-time" compact value={preferences.reminderTime} onChange={(e) => update({ reminderTime: e.target.value })}>
              {Array.from({ length: 34 }, (_, i) => `${String(Math.floor(i / 2) + 6).padStart(2, "0")}:${i % 2 ? "30" : "00"}`).map((t) => <option key={t} value={t}>{t}</option>)}
            </NativeSelect>
          </div>
        )}
        <SwitchRow id="rec-shortcuts" label="Recording keyboard shortcuts" hint="Ctrl+Enter starts or stops a take in the studio." checked={preferences.recordingShortcuts} onCheckedChange={(on) => update({ recordingShortcuts: on })} />
        <SwitchRow id="live-pace" label="Show live pace while recording" hint="An estimate from the audio. There's no right speed; it shows your range." checked={preferences.livePace} onCheckedChange={(on) => update({ livePace: on })} />
      </Section>
      <SurpriseSettings />
      <LearningSettings />
      <WordsToWatch />
      <PracticeStyleSettings />
      <Section title="Languages">
        <div className="space-y-1">
          <Label htmlFor="first-language">Your first language (optional)</Label>
          <Select value={preferences.firstLanguage ?? "none"} onValueChange={(v) => update({ firstLanguage: v === "none" ? null : v as Preferences["firstLanguage"] })}>
            <SelectTrigger id="first-language" className="h-10 w-64"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">Prefer not to say</SelectItem>
              {FIRST_LANGUAGES.map((l) => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-meta text-muted-foreground">Optional practice ideas in Exercises → Guides. Choose only if useful to you.</p>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1">
          <dt className="text-muted-foreground">Interface</dt><dd>English (dates in British format)</dd>
          <dt className="text-muted-foreground">Practice</dt><dd>English</dd>
        </dl>
        <p className="text-meta text-muted-foreground">This version is for practising English. German practice may follow later.</p>
      </Section>
    </>
  );
}

/**
 * How practice is offered (roadmap M11): a warm-up game, when measures show
 * (11.4) and guessing first (11.5). Each is optional and changes nothing you
 * recorded.
 */
export function LearningSettings() {
  const qc = useQueryClient();
  const { preferences, update } = usePreferences();
  return (
    <Section title="How you practise" description="Optional ways to practise, drawn from learning research. They change how practice is offered, never your recordings.">
      <SwitchRow
        id="warm-up"
        label="Start with a 2-minute warm-up game"
        hint="Today's plan begins with a short drill for the area you've practised least."
        checked={preferences.warmUp}
        onCheckedChange={(on) => update({ warmUp: on }, { onSettled: () => qc.invalidateQueries({ queryKey: ["today"] }) })}
      />
      <fieldset>
        <legend className="text-body font-medium">When to show measures</legend>
        <p className="mb-2 text-meta text-muted-foreground">Flow and Words under each take. What went well and your self-check always show.</p>
        <RadioGroup value={preferences.measuresTiming} onValueChange={(v) => update({ measuresTiming: v as Preferences["measuresTiming"] })} className="gap-2">
          {MEASURES_TIMING.map((m) => (
            <Label
              key={m.value}
              htmlFor={`timing-${m.value}`}
              className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary"
            >
              <RadioGroupItem id={`timing-${m.value}`} value={m.value} className="mt-0.5" />
              <span>
                <span className="block font-medium">{m.label}</span>
                <span className="block text-meta text-muted-foreground">{m.hint}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </fieldset>
      <DisplayNameRow />
      <SwitchRow
        id="predict-first"
        label="Guess before you see the measures"
        hint="When a take is transcribed, guess your hesitations and pace first, then compare. Your guesses are kept as your notes."
        checked={preferences.predictFirst}
        onCheckedChange={(on) => update({ predictFirst: on, predictTipSeen: true })}
      />
    </Section>
  );
}

/** The name the pre-talk routine encourages you with (12.3); saved when you leave the field. */
function DisplayNameRow() {
  const { preferences, update, loaded } = usePreferences();
  const [name, setName] = useState<string | null>(null);
  const value = name ?? preferences.displayName;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <Label htmlFor="display-name">Name for encouragement</Label>
        <p className="text-meta text-muted-foreground">The pre-talk routine says it back to you. Leave it empty to hear “you”.</p>
      </div>
      <Input
        id="display-name"
        className="h-10 w-56"
        maxLength={40}
        disabled={!loaded}
        value={value}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => value.trim() !== preferences.displayName && update({ displayName: value.trim() })}
      />
    </div>
  );
}

const MAX_WATCH_WORDS = 20;
const MAX_WATCH_WORD_CHARS = 30;

/** Words to watch (roadmap 8.11): you decide which habits to notice; the app doesn't decide for you. */
export function WordsToWatch() {
  const { preferences, update } = usePreferences();
  const [draft, setDraft] = useState("");
  const words = preferences.watchWords;
  const clean = draft.trim().replace(/\s+/g, " ").toLowerCase();
  const problem = !clean
    ? null
    : clean.length > MAX_WATCH_WORD_CHARS
      ? `Keep it under ${MAX_WATCH_WORD_CHARS} characters.`
      : words.includes(clean) || (WATCH_WORDS as readonly string[]).includes(clean)
        ? "Already on the list."
        : words.length >= MAX_WATCH_WORDS
          ? `Up to ${MAX_WATCH_WORDS} words of your own.`
          : null;
  const add = () => {
    if (!clean || problem) return;
    update({ watchWords: [...words, clean] });
    setDraft("");
  };
  return (
    <Section title="Words to watch" description="Words you use often are counted in every take summary. Counting a word doesn't mean it's wrong.">
      <div className="space-y-1">
        <p className="text-meta text-muted-foreground">Counted in every take</p>
        <ul aria-label="Default words to watch" className="flex flex-wrap gap-1.5">
          {WATCH_WORDS.map((w) => <li key={w} className="rounded-full border px-2.5 py-0.5 text-meta">{w}</li>)}
        </ul>
      </div>
      <div className="space-y-2">
        <Label htmlFor="watch-word">Your words</Label>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Input id="watch-word" className="max-w-64" maxLength={60} placeholder="e.g. like" value={draft} onChange={(e) => setDraft(e.target.value)} aria-describedby="watch-word-hint" />
          <Button type="submit" variant="outline" disabled={!clean || !!problem}>
            <Plus aria-hidden /> Add
          </Button>
        </form>
        <p id="watch-word-hint" className={cn("text-meta", problem ? "text-destructive" : "text-muted-foreground")}>
          {problem ?? (clean === "like" ? "“Like” is counted every time, including ordinary uses." : `Up to ${MAX_WATCH_WORDS} words or short phrases.`)}
        </p>
        {words.length > 0 && (
          <ul aria-label="Your words to watch" className="flex flex-wrap gap-1.5">
            {words.map((w) => (
              <li key={w} className="flex items-center gap-1 rounded-full border bg-secondary py-0.5 pr-1 pl-2.5 text-meta">
                {w}
                <Button type="button" variant="ghost" size="icon-sm" className="size-6 rounded-full" aria-label={`Remove ${w}`} onClick={() => update({ watchWords: words.filter((x) => x !== w) })}>
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

const STYLES: { value: Preferences["practiceStyle"]; label: string; hint: string }[] = [
  { value: "playful", label: "Playful", hint: "Levels, effort points, achievements and short celebrations. Nothing is ever scored." },
  { value: "calm", label: "Calm", hint: "Just practice and evidence. Your progress is still kept, so you can switch back any time." },
];

/** Practice style (roadmap 7.5, D-32): whether the game layer shows, and how celebrations look. */
export function PracticeStyleSettings() {
  const { preferences, update } = usePreferences();
  const reducedMotion = useReducedMotion();
  const calm = preferences.practiceStyle === "calm";
  return (
    <Section title="Practice style" description="How practice feels. Your recordings and progress are the same in both styles.">
      <fieldset>
        <legend className="sr-only">Practice style</legend>
        <RadioGroup
          value={preferences.practiceStyle}
          onValueChange={(v) => update({ practiceStyle: v as Preferences["practiceStyle"], styleChosen: true })}
          className="grid gap-3 sm:grid-cols-2"
        >
          {STYLES.map((s) => (
            <Label
              key={s.value}
              htmlFor={`style-${s.value}`}
              className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary"
            >
              <RadioGroupItem id={`style-${s.value}`} value={s.value} className="mt-0.5" />
              <span>
                <span className="block font-medium">{s.label}</span>
                <span className="block text-meta text-muted-foreground">{s.hint}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor="celebrations">Celebrations</Label>
        <Select value={preferences.celebrations} onValueChange={(v) => update({ celebrations: v as Preferences["celebrations"] })} disabled={calm}>
          <SelectTrigger id="celebrations" className="h-10 w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="full">Full: a short animated card</SelectItem>
            <SelectItem value="subtle">Subtle: a quiet message</SelectItem>
            <SelectItem value="off">Off: just list them in Journey</SelectItem>
          </SelectContent>
        </Select>
        {calm ? (
          <p className="text-meta text-muted-foreground">Calm style shows no celebrations.</p>
        ) : (
          reducedMotion && preferences.celebrations === "full" && (
            <p className="text-meta text-muted-foreground">Windows asks for reduced motion, so celebrations stay still.</p>
          )
        )}
      </div>
      <SwitchRow
        id="celebration-sounds"
        label="Celebration sound"
        hint="A soft chime with each celebration."
        checked={preferences.celebrationSounds}
        disabled={calm || preferences.celebrations === "off"}
        onCheckedChange={(on) => update({ celebrationSounds: on })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="weekly-goal">Weekly goal</Label>
          <Select value={String(preferences.weeklyGoalDays)} onValueChange={(v) => update({ weeklyGoalDays: Number(v) })}>
            <SelectTrigger id="weekly-goal" className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "day" : "days"} a week</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-meta text-muted-foreground">Rest days are part of practice. The goal resets each week; nothing is lost.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="week-start">Week starts on</Label>
          <Select value={preferences.weekStartsOn} onValueChange={(v) => update({ weekStartsOn: v as Preferences["weekStartsOn"] })}>
            <SelectTrigger id="week-start" className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monday">Monday</SelectItem>
              <SelectItem value="sunday">Sunday</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <SwitchRow
        id="companion"
        label="Companion"
        hint="Sprout, a small plant that grows with your practice days. It never wilts or shrinks."
        checked={preferences.companion}
        onCheckedChange={(on) => update({ companion: on })}
      />
      {calm && (
        <p className="text-meta">
          Your levels and achievements are still kept. <RouterLink className="text-primary underline underline-offset-2 hover:no-underline" to="/journey">Open Journey anyway</RouterLink>
        </p>
      )}
    </Section>
  );
}

/** Page zoom in steps from 80 % to 200 %, the same as Ctrl + / Ctrl − (remembered on this computer). */
function ZoomRow() {
  const zoom = useZoomLevel();
  const native = useIpc().recordingMode === "native";
  if (!native) return <p className="text-meta text-muted-foreground">Zoom (Ctrl + and Ctrl −) is set in the desktop app; here the browser's own zoom applies.</p>;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-medium" id="zoom-label">Zoom</p>
        <p className="text-meta text-muted-foreground">Makes text and controls larger or smaller. Ctrl + and Ctrl − do the same; Ctrl 0 resets.</p>
      </div>
      <div role="group" aria-labelledby="zoom-label" className="flex items-center gap-1">
        <Button variant="outline" size="icon" aria-label="Zoom out" disabled={zoom <= ZOOM_STEPS[0]} onClick={() => setZoomLevel(stepZoom(zoom, -1))}><Minus aria-hidden /></Button>
        <output aria-live="polite" className="w-16 text-center tabular-nums">{Math.round(zoom * 100)} %</output>
        <Button variant="outline" size="icon" aria-label="Zoom in" disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} onClick={() => setZoomLevel(stepZoom(zoom, 1))}><Plus aria-hidden /></Button>
        <Button variant="ghost" disabled={zoom === 1} onClick={() => setZoomLevel(1)}>Reset</Button>
      </div>
    </div>
  );
}

function AppearanceSettings() {
  const theme = useTheme();
  return (
    <Section title="Appearance">
      <fieldset>
        <legend className="mb-2 text-body font-medium">Theme</legend>
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
      <ZoomRow />
      <AccentSettings />
    </Section>
  );
}

/** Accent colours (roadmap 9.12): green, plus the ones you unlocked. Unlocked colours stay unlocked. */
export function AccentSettings() {
  const ipc = useIpc();
  const { preferences, update } = usePreferences();
  const week = weekStart(toLocalDate(new Date()), preferences.weekStartsOn);
  const state = useQuery({ queryKey: queryKeys.engagementState(week), queryFn: () => ipc.getEngagementState(week) });
  const unlocked = unlockedAccents(state.data);
  return (
    <fieldset>
      <legend className="mb-2 text-body font-medium">Accent colour</legend>
      <RadioGroup value={preferences.accent} onValueChange={(v) => update({ accent: v as Preferences["accent"] })} className="grid gap-2 sm:grid-cols-2">
        {ACCENTS.map((a) => {
          const open = unlocked.has(a.id);
          return (
            <Label
              key={a.id}
              htmlFor={`accent-${a.id}`}
              data-accent={a.id}
              className={cn("flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 font-normal", open ? "cursor-pointer has-[[data-state=checked]]:border-primary" : "cursor-not-allowed")}
            >
              <RadioGroupItem id={`accent-${a.id}`} value={a.id} disabled={!open} aria-labelledby={`accent-${a.id}-name`} aria-describedby={open ? undefined : `accent-${a.id}-unlock`} />
              <span aria-hidden className="size-6 shrink-0 rounded-full border bg-[var(--cp-accent)]" />
              <span className="min-w-0">
                <span id={`accent-${a.id}-name`} className="block font-medium">{a.name}</span>
                {!open && (
                  <span id={`accent-${a.id}-unlock`} className="flex items-center gap-1 text-meta text-muted-foreground">
                    <Lock aria-hidden className="size-3" /> Unlocks with: {a.unlock}
                  </span>
                )}
              </span>
            </Label>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}

function TranscriptionSettings() {
  const { preferences, update } = usePreferences();
  return (
    <>
      <Section title="Default transcription" description="How new takes are transcribed. You can switch on any take.">
        <TranscriptionMode />
        <SwitchRow
          id="auto-transcribe"
          label="Transcribe each new take automatically"
          hint="Each new take is transcribed with local Whisper as soon as you stop, so its summary appears under it. This works whenever local Whisper is set up, also when Cloud is your default for transcribing by hand. Recording always comes first, and nothing is ever sent to a cloud provider automatically."
          checked={preferences.autoTranscribe}
          onCheckedChange={(on) => update({ autoTranscribe: on })}
        />
      </Section>
      <Section title="Local Whisper" description="Speech is transcribed on this computer. Audio is never uploaded. The setup file decides the model and whether the NVIDIA GPU or the CPU is used; there is no automatic fallback. Choose another setup file to switch.">
        <TranscriptionSetup />
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
        <RadioGroup value={mode} onValueChange={(v) => update({ coachingMode: v as Preferences["coachingMode"] })} className="gap-3">
          {(
            [
              ["api", "API", "Your own OpenAI account. A take's transcript text and measures leave this computer only when you press Send on a preview.", false],
              ["local", "Local LLM", "A llama.cpp-compatible server you run on this computer (loopback only). Nothing leaves the computer and nothing is billed.", false],
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

      {mode === "local" && <LocalModelSettings />}

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
          <CoachingPrices />
          <p className="text-meta text-muted-foreground">Warning at USD 4.00 and stop at USD 5.00 a month, shared with cloud transcription (fixed in this version).</p>
          <CoachingSpike />
        </Section>
      )}
    </>
  );
}

/** Local LLM (5.4, 5.10): address on this computer, optional model name, Test connection. */
function LocalModelSettings() {
  const ipc = useIpc();
  const { preferences, update } = usePreferences();
  const [endpoint, setEndpoint] = useState(preferences.localEndpoint);
  const [model, setModel] = useState(preferences.localModel);
  const test = useMutation({ mutationFn: () => ipc.testLocalLlm(endpoint) });
  const save = useMutation({ mutationFn: () => ipc.setPreferences({ ...preferences, localEndpoint: endpoint, localModel: model }) });
  return (
    <Section title="Local model" description="Only a server on this computer (127.0.0.1, localhost or [::1]) is accepted. A server elsewhere belongs to API mode. Nothing is downloaded by the app.">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="llm-endpoint">Server address</Label>
          <Input id="llm-endpoint" value={endpoint} placeholder="http://127.0.0.1:8080" onChange={(e) => { setEndpoint(e.target.value); test.reset(); save.reset(); }} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="llm-model">Model name (optional)</Label>
          <Input id="llm-model" value={model} placeholder="The server's loaded model" onChange={(e) => { setModel(e.target.value); save.reset(); }} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? "Testing…" : "Test connection"}</Button>
        <Button disabled={save.isPending || (endpoint === preferences.localEndpoint && model === preferences.localModel)}
          onClick={() => save.mutate(undefined, { onSuccess: (saved) => update({ localEndpoint: saved.localEndpoint, localModel: saved.localModel }) })}>Save</Button>
      </div>
      {test.data && <p role="status" className="text-meta">Connected. {test.data.length ? `Models: ${test.data.join(", ")}.` : "The server listed no models; its loaded model is used."}</p>}
      {(test.error ?? save.error) && <p role="alert" className="text-meta text-destructive">{(test.error ?? save.error)!.message}</p>}
      {save.isSuccess && <p role="status" className="text-meta">Saved.</p>}
      <p className="text-meta text-muted-foreground">For example, start llama.cpp with <code>llama-server -m your-model.gguf --port 8080</code>. Feedback requests are previewed the same way; quotes are checked against your transcript.</p>
    </Section>
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
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-body">
          <dt className="text-muted-foreground">Data folder</dt>
          <dd><DataFolder /></dd>
          <dt className="text-muted-foreground">Recordings</dt>
          <dd><RecordingTotals /></dd>
        </dl>
      </Section>
      <Section title="Space used" description="What the data folder holds. Clearing the cache never removes recordings or anything you saved.">
        <StorageUsage />
        <DatabaseHealth />
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

function TakeTourButton() {
  const tour = useTour();
  return (
    <Button variant="outline" className="w-fit" onClick={tour.start}>
      <Compass aria-hidden /> Take the guided tour
    </Button>
  );
}

function AboutSettings() {
  return (
    <>
    <Section title="About ClearPractice">
      <p>Version 0.1.0 · development preview</p>
      <p className="text-muted-foreground">
        A practice aid, not an assessment. It doesn't award proficiency levels, and automatic observations are estimates
        you can inspect and correct.
      </p>
      <p className="text-meta text-muted-foreground">
        No analytics, no account, and no network use except what you explicitly ask for.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="w-fit" asChild><NavLink to="/welcome">Run the first-launch setup again</NavLink></Button>
        <TakeTourButton />
      </div>
    </Section>
    <Section title="Performance" description="Measured on this computer during this run. A development build is slower than the installed app.">
      <Performance />
    </Section>
    <Section title="Diagnostic report" description="For reporting a problem: versions, counts and settings states, without your recordings, words or names. You read it before saving it.">
      <DiagnosticReport />
    </Section>
    </>
  );
}
