import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Check } from "lucide-react";
import { Page, PageHeader, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePreferences } from "@/lib/ipc/queries";
import type { Preferences } from "@/lib/ipc/schemas";
import { cn } from "@/lib/utils";
import { AudioSettings } from "@/features/settings/SettingsPage";
import { TranscriptionMode } from "@/features/settings/TranscriptionMode";

const STEPS = ["Your goal", "Microphone", "Services", "Baseline (optional)"] as const;

const GOALS: { value: Preferences["goals"][number]; label: string; hint: string }[] = [
  { value: "clarity", label: "Clarity", hint: "Getting the main point across" },
  { value: "hesitation", label: "Less hesitation", hint: "Fewer stops and fillers while thinking" },
  { value: "phrasing", label: "English phrasing", hint: "More natural expressions" },
  { value: "confidence", label: "Confidence", hint: "In a particular setting, like meetings" },
];

/**
 * First launch in four short steps (4.19, blueprint §5). Every step can be
 * skipped; skipping keeps manual practice available. Goals change which
 * focuses come up, never a diagnosis or a level. Nothing here sends anything.
 */
export function WelcomePage() {
  const navigate = useNavigate();
  const { preferences, update } = usePreferences();
  const [step, setStep] = useState(0);
  const finish = (to: string) => {
    update({ onboarded: true });
    navigate(to);
  };
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));

  return (
    <Page className="max-w-3xl">
      <PageHeader title="Welcome to ClearPractice" description="Four short steps, about three minutes. Everything can be changed later in Settings, and every step can be skipped." />
      <ol className="mb-6 grid gap-2 sm:grid-cols-4" aria-label="Setup steps">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "flex h-10 w-full items-center gap-2 rounded-lg border px-3 text-left text-meta transition-colors",
                i === step ? "border-primary bg-secondary font-medium" : "text-muted-foreground hover:bg-secondary/60",
              )}
            >
              <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums", i < step && "border-primary bg-primary text-primary-foreground")}>
                {i < step ? <Check aria-hidden className="size-3" /> : i + 1}
              </span>
              <span className="truncate">{label}</span>
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Panel className="space-y-5">
          <div className="space-y-2">
            <h2 className="font-semibold">What would you like to improve?</h2>
            <p className="text-meta text-muted-foreground">Choose any. This changes which focuses come up first, not a diagnosis or a level.</p>
            <ToggleGroup type="multiple" variant="outline" aria-label="Goals" className="grid w-full gap-2 sm:grid-cols-2" value={preferences.goals}
              onValueChange={(v) => update({ goals: v as Preferences["goals"] })}>
              {GOALS.map((g) => (
                <ToggleGroupItem key={g.value} value={g.value} className="h-auto flex-col items-start rounded-lg px-3 py-2 text-left data-[state=on]:border-primary">
                  <span className="font-medium">{g.label}</span>
                  <span className="text-meta font-normal text-muted-foreground">{g.hint}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="space-y-1">
            <Label htmlFor="goal-note">In your own words (optional)</Label>
            <Input id="goal-note" maxLength={300} placeholder="e.g. Explain technical designs clearly in meetings" defaultValue={preferences.goalNote}
              onBlur={(e) => e.target.value !== preferences.goalNote && update({ goalNote: e.target.value })} />
          </div>
          <fieldset className="space-y-2">
            <legend className="font-medium">Where does it show?</legend>
            <RadioGroup value={preferences.difficultyLanguage ?? ""} onValueChange={(v) => update({ difficultyLanguage: v as "english" | "both" })} className="gap-2">
              <Label htmlFor="lang-english" className="flex items-center gap-2 font-normal"><RadioGroupItem id="lang-english" value="english" /> Mainly when I speak English</Label>
              <Label htmlFor="lang-both" className="flex items-center gap-2 font-normal"><RadioGroupItem id="lang-both" value="both" /> Also in my strongest language</Label>
            </RadioGroup>
            <p className="text-meta text-muted-foreground">
              {preferences.difficultyLanguage === "both"
                ? "Then structure and pauses matter as much as wording; the exercises cover both."
                : "This only shifts emphasis between structure and wording."}
            </p>
          </fieldset>
          <StepButtons onNext={next} onSkip={() => finish("/")} />
        </Panel>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <AudioSettings />
          <Panel><StepButtons onBack={() => setStep(0)} onNext={next} onSkip={() => finish("/")} /></Panel>
        </div>
      )}

      {step === 2 && (
        <Panel className="space-y-5">
          <div className="space-y-2">
            <h2 className="font-semibold">Transcription</h2>
            <p className="text-meta text-muted-foreground">
              Turns your recordings into text for review. On this computer, audio never leaves it. With a cloud service, a take is sent only after you listen to a preview and press Send.
            </p>
            <TranscriptionMode />
            <p className="text-meta"><Link className="underline" to="/settings/transcription">Set up local transcription or add a cloud key in Settings</Link></p>
          </div>
          <div className="space-y-2 border-t pt-4">
            <h2 className="font-semibold">AI feedback</h2>
            <p className="text-meta text-muted-foreground">
              Optional feedback on a take's transcript, sent as text (never audio) after you read exactly what will be sent and press Send.
            </p>
            <RadioGroup value={preferences.coachingMode} onValueChange={(v) => update({ coachingMode: v as "api" | "off" })} className="gap-2">
              <Label htmlFor="ob-coach-api" className="flex items-center gap-2 font-normal"><RadioGroupItem id="ob-coach-api" value="api" /> OpenAI API with my own key</Label>
              <Label htmlFor="ob-coach-off" className="flex items-center gap-2 font-normal"><RadioGroupItem id="ob-coach-off" value="off" /> Off: no text is sent anywhere</Label>
            </RadioGroup>
            <p className="text-meta"><Link className="underline" to="/settings/coaching">Store a key and test it in Settings</Link></p>
          </div>
          <p className="text-meta text-muted-foreground">Skipping keeps manual practice available. Choosing a service never sends a recording by itself.</p>
          <StepButtons onBack={() => setStep(1)} onNext={next} onSkip={() => finish("/")} />
        </Panel>
      )}

      {step === 3 && (
        <Panel className="space-y-4">
          <h2 className="font-semibold">A 60-second baseline</h2>
          <p>“Describe something you would like to get better at and why.”</p>
          <p className="text-meta text-muted-foreground">
            It is saved with a baseline tag so you can listen back later. Later comparisons also use unfamiliar prompts, so improvement is not judged only from rehearsed answers.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => finish("/practice/ex-repeat?prompt=baseline")}>Record the baseline</Button>
            <Button variant="outline" onClick={() => finish("/")}>Skip and go to Today</Button>
            <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
          </div>
        </Panel>
      )}
    </Page>
  );
}

function StepButtons({ onBack, onNext, onSkip }: { onBack?: () => void; onNext: () => void; onSkip: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button onClick={onNext}>Continue</Button>
      {onBack && <Button variant="ghost" onClick={onBack}>Back</Button>}
      <Button className="ml-auto" variant="ghost" onClick={onSkip}>Skip setup</Button>
    </div>
  );
}
