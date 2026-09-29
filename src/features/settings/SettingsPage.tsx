import { useState, type ReactNode } from "react";
import { NavLink, useParams } from "react-router";
import { useTheme, type ThemePreference } from "@/app/theme";
import { Page, PageHeader, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useInputDevices } from "@/lib/ipc/queries";
import { cn } from "@/lib/utils";

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
      <div className="grid gap-6 md:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections">
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
        <div className="max-w-2xl space-y-6">
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

function Later({ milestone, children }: { milestone: number; children: ReactNode }) {
  return (
    <p className="text-meta text-muted-foreground">
      {children} <span className="whitespace-nowrap">(available from milestone {milestone})</span>
    </p>
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
  const list = devices.data ?? [];
  const [device, setDevice] = useState<string>("");
  const selected = device || list.find((d) => d.isDefault)?.id || "";

  return (
    <Section title="Microphone" description="The microphone is on only during a test or a recording.">
      <div className="space-y-1">
        <Label htmlFor="mic">Input device</Label>
        <Select value={selected} onValueChange={setDevice} disabled={devices.isPending}>
          <SelectTrigger id="mic" className="h-10 w-full">
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
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled>
          Test microphone
        </Button>
        <Later milestone={2}>Records five seconds and plays them back.</Later>
      </div>
      <SwitchRow id="rec-sounds" label="Recording sounds" hint="A short tone when recording starts and stops." defaultChecked />
    </Section>
  );
}

function PracticeSettings() {
  return (
    <>
      <Section title="Sessions">
        <div className="space-y-1">
          <Label htmlFor="default-length">Default session length</Label>
          <Select defaultValue="standard">
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
        <SwitchRow id="rec-shortcuts" label="Recording keyboard shortcuts" hint="Ctrl+Enter starts or stops a take in the studio." defaultChecked />
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
      <Section title="Local Whisper" description="Speech is transcribed on this computer. Audio is never uploaded.">
        <div className="rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <p className="font-medium">base.en</p>
              <p className="text-meta text-muted-foreground">English · 142 MiB · first benchmark candidate</p>
            </div>
            <span className="text-meta text-muted-foreground">Not installed</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
            <div>
              <p className="font-medium">small.en</p>
              <p className="text-meta text-muted-foreground">English · 466 MiB · compare on your own sample first</p>
            </div>
            <span className="text-meta text-muted-foreground">Not installed</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled>Import pack</Button>
          <Button variant="outline" disabled>Run benchmark</Button>
        </div>
        <Later milestone={3}>Model packs are checksum-verified before use.</Later>
      </Section>
      <Section title="Acceleration" description="Detected: AMD Ryzen 7 3750H · NVIDIA GeForce GTX 1650 (4 GB).">
        <RadioGroup defaultValue="auto" className="gap-2">
          {(
            [
              ["auto", "Choose after benchmark"],
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
    </>
  );
}

type CoachingMode = "api" | "local_llm" | "off";

function CoachingSettings() {
  const [mode, setMode] = useState<CoachingMode>("api");
  return (
    <>
      <Section
        title="Coaching provider"
        description="Independent of transcription. Switching providers never uploads audio or downloads a model."
      >
        <RadioGroup value={mode} onValueChange={(v) => setMode(v as CoachingMode)} className="gap-3">
          {(
            [
              ["api", "API", "Your own provider account. Selected text leaves this computer when you ask for feedback."],
              ["local_llm", "Local LLM", "A server you run yourself on this computer (loopback only)."],
              ["off", "Off", "No text is sent anywhere. Playback, transcript, and manual review still work."],
            ] as const
          ).map(([v, l, hint]) => (
            <Label key={v} htmlFor={`mode-${v}`} className="flex items-start gap-3 font-normal">
              <RadioGroupItem id={`mode-${v}`} value={v} className="mt-1" />
              <span>
                <span className="block font-medium">{l}</span>
                <span className="block text-meta text-muted-foreground">{hint}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </Section>

      {mode === "api" && (
        <Section title="API connection" description="Requests may be billed by your provider. Their data-retention terms apply to text you send.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="api-protocol">Provider</Label>
              <Select disabled>
                <SelectTrigger id="api-protocol" className="h-10 w-full"><SelectValue placeholder="Not chosen yet" /></SelectTrigger>
                <SelectContent />
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="api-model">Model ID</Label>
              <Input id="api-model" className="h-10" disabled placeholder="Set after choosing a provider" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>API key</Label>
            <p className="text-meta text-muted-foreground">
              No key stored. Keys are kept in Windows Credential Manager, never in the app database, logs, or backups.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="budget-warn">Monthly warning at</Label>
              <Input id="budget-warn" className="h-10" disabled placeholder="e.g. 3.00 USD" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="budget-stop">Stop new requests at</Label>
              <Input id="budget-stop" className="h-10" disabled placeholder="e.g. 5.00 USD" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" disabled>Test connection</Button>
            <Later milestone={5}>The test sends a small labelled request and may be billed.</Later>
          </div>
        </Section>
      )}

      {mode === "local_llm" && (
        <Section title="Local endpoint" description="Only loopback addresses count as “on this computer”. A LAN or remote server belongs to API mode.">
          <div className="space-y-1">
            <Label htmlFor="llm-endpoint">Endpoint</Label>
            <Input id="llm-endpoint" className="h-10" disabled placeholder="http://127.0.0.1:8080" />
          </div>
          <Later milestone={5}>Tested against a llama.cpp-compatible server.</Later>
        </Section>
      )}
    </>
  );
}

function DataSettings() {
  return (
    <>
      <Section title="Storage" description="Recordings, transcripts, and notes are stored in your Windows user profile.">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
          <dt className="text-muted-foreground">Data folder</dt>
          <dd>Set up in milestone 2</dd>
          <dt className="text-muted-foreground">Recordings</dt>
          <dd>None yet</dd>
        </dl>
      </Section>
      <Section
        title="Backups"
        description="A backup on another drive protects against drive failure. A copy on the same drive doesn't. API keys are never included."
      >
        <p>
          Last successful backup: <span className="font-medium">never</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled>Create backup</Button>
          <Button variant="outline" disabled>Restore…</Button>
          <Button variant="outline" disabled>Export a session</Button>
        </div>
        <Later milestone={2}>Backup, restore, and readable exports (Markdown, CSV, WAV).</Later>
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
