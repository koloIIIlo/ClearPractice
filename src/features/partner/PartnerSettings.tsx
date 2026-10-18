import { useId, useState } from "react";
import { Volume2 } from "lucide-react";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { usePreferences } from "@/lib/ipc/queries";
import { pickPartnerVoice, speakText } from "@/lib/speech";
import { useOfflineVoices } from "./voices";

const AUTOMATIC = "automatic";
const SAMPLE = "Hi, I'm your practice partner. Shall we begin?";

/**
 * Settings → Partner (roadmap 13.7): the partner's offline voice and speed,
 * sending to a local model without asking, and the cost limit a new OpenAI
 * conversation starts with. The app never downloads voices.
 */
export function PartnerSettings() {
  const { preferences, update, loaded } = usePreferences();
  const voices = useOfflineVoices();
  const id = useId();
  const [limit, setLimit] = useState<string | null>(null);
  const limitText = limit ?? (preferences.partnerMaxCostMicroUsd / 1_000_000).toFixed(2);
  const limitMicro = Math.round(Number(limitText) * 1_000_000);
  const limitOk = Number.isFinite(limitMicro) && limitMicro >= 10_000 && limitMicro <= 5_000_000;
  const chosen = voices.some((v) => v.name === preferences.partnerVoice) ? preferences.partnerVoice! : AUTOMATIC;
  const sample = () => void speakText(SAMPLE, { voice: pickPartnerVoice(voices, preferences.partnerVoice, "any"), rate: preferences.partnerRate });

  return (
    <Panel>
      <h2 className="font-semibold">Partner</h2>
      <p className="mt-1 text-meta text-muted-foreground">How the practice partner sounds, and what it may send.</p>
      <div className="mt-4 space-y-5">
        {voices.length === 0 ? (
          <p role="note" className="rounded-lg border p-3 text-meta">
            No offline English voice found on this computer, so the partner's lines show as captions. You can add a voice in Windows: Settings → Time &amp; language → Speech. The app never downloads voices.
          </p>
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor={`${id}-voice`}>Voice</Label>
              <p className="text-meta text-muted-foreground">Offline English voices installed in Windows. Automatic picks one that suits each partner.</p>
              <Select value={chosen} onValueChange={(v) => update({ partnerVoice: v === AUTOMATIC ? null : v })}>
                <SelectTrigger id={`${id}-voice`} className="w-64 max-w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTOMATIC}>Automatic</SelectItem>
                  {voices.map((v) => (
                    <SelectItem key={v.name} value={v.name}>{v.name} ({v.lang})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={sample}>
              <Volume2 aria-hidden /> Play sample
            </Button>
          </div>
        )}
        <div className="space-y-2">
          <Label id={`${id}-rate`}>Speed</Label>
          <div className="flex items-center gap-3">
            <Slider className="max-w-64" min={0.8} max={1.2} step={0.05} value={[preferences.partnerRate]} onValueChange={([v]) => update({ partnerRate: Math.round(v * 100) / 100 })}
              aria-labelledby={`${id}-rate`} aria-valuetext={`${preferences.partnerRate.toFixed(2)} times normal speed`} />
            <span className="text-meta tabular-nums">{preferences.partnerRate.toFixed(2)}×</span>
          </div>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor={`${id}-auto`}>Send turns to a local model without asking</Label>
            <p className="text-meta text-muted-foreground">
              The default for new conversations with a model on this computer; nothing leaves it. Turns to OpenAI always wait for your Send.
            </p>
          </div>
          <Switch id={`${id}-auto`} checked={preferences.partnerAutoSendLocal} onCheckedChange={(on) => update({ partnerAutoSendLocal: on })} />
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Label htmlFor={`${id}-limit`}>Default cost limit (USD)</Label>
            <p className="text-meta text-muted-foreground">Each OpenAI conversation starts with this limit; you can change it per conversation. The monthly budget applies as well.</p>
            {!limitOk && <p role="alert" className="text-meta text-destructive">Choose between 0.01 and 5.00.</p>}
          </div>
          <Input id={`${id}-limit`} className="h-10 w-32" type="number" inputMode="decimal" min={0.01} max={5} step={0.01} disabled={!loaded} value={limitText}
            onChange={(e) => setLimit(e.target.value)} onBlur={() => limitOk && limitMicro !== preferences.partnerMaxCostMicroUsd && update({ partnerMaxCostMicroUsd: limitMicro })} />
        </div>
      </div>
    </Panel>
  );
}
