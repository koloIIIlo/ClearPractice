import { useState } from "react";
import { useIpc } from "@/lib/ipc";
import { usePreferences } from "@/lib/ipc/queries";
import type { Preferences } from "@/lib/ipc/schemas";
import { Panel } from "@/components/page";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
const times = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
const days: Preferences["surpriseDays"] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
export function SurpriseSettings() {
  const ipc = useIpc();
  const { preferences: p, update } = usePreferences();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const notifications = async (on: boolean) => {
    if (!on) { update({ surpriseNotifications: false }); return; }
    setAsking(true);
    setError("");
    try {
      const granted = await ipc.requestNotificationPermission();
      update({ surpriseNotifications: granted });
      if (!granted) setError("Windows notifications are unavailable or permission was not granted. In-app prompts still work.");
    } catch { setError("Windows permission could not be requested. Try again."); }
    finally { setAsking(false); }
  };
  return <Panel>
    <div className="flex items-center justify-between gap-4"><Label htmlFor="surprise" className="font-semibold">Surprise prompts</Label>
      <Switch id="surprise" checked={p.surpriseEnabled} onCheckedChange={(on) => update({ surpriseEnabled: on })} /></div>
    <p className="mt-2 text-meta text-muted-foreground">A 1–2 minute prompt while the app is open. At most once a day. No penalty for skipping.</p>
    <fieldset disabled={!p.surpriseEnabled} className="mt-4 space-y-4 disabled:opacity-60">
      <legend className="sr-only">Surprise prompt schedule</legend>
      <div className="flex flex-wrap items-center gap-2"><span>Between</span>
        {(["surpriseStart", "surpriseEnd"] as const).map((key) => <Select key={key} value={p[key]} onValueChange={(v) => update({ [key]: v })}>
          <SelectTrigger aria-label={key === "surpriseStart" ? "Window start" : "Window end"} className="h-10 w-28"><SelectValue /></SelectTrigger>
          <SelectContent>{times.map((time) => <SelectItem key={time} value={time} disabled={key === "surpriseStart" ? time >= p.surpriseEnd : time <= p.surpriseStart}>{time}</SelectItem>)}</SelectContent>
        </Select>)}
      </div>
      <div><p className="mb-2">Days</p><ToggleGroup type="multiple" variant="outline" aria-label="Days" className="flex-wrap" value={p.surpriseDays} onValueChange={(v) => update({ surpriseDays: v as Preferences["surpriseDays"] })}>
        {days.map((day) => <ToggleGroupItem className="h-10 min-w-10" key={day} value={day} aria-label={day}>{day.slice(0, 3)}</ToggleGroupItem>)}
      </ToggleGroup></div>
      <div className="flex min-h-10 items-center gap-2"><Checkbox id="surprise-notifications" checked={p.surpriseNotifications} disabled={asking} onCheckedChange={(on) => void notifications(on === true)} /><Label htmlFor="surprise-notifications">Show as a Windows notification</Label></div>
      <p className="text-meta text-muted-foreground">Only while ClearPractice is running. Turning this on asks Windows permission.</p>
      {error && <p role="status" className="text-meta text-muted-foreground">{error}</p>}
    </fieldset>
  </Panel>;
}
