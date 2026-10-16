import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { usePreferences } from "@/lib/ipc/queries";

/**
 * The one-time Playful-or-Calm choice (roadmap 7.5, D-32), for people who have
 * already practised. Either button records the choice; Calm also switches the
 * game layer off. Settings → Practice changes it any time.
 */
export function StyleChoiceCard() {
  const { update } = usePreferences();
  return (
    <Panel className="flex flex-wrap items-center gap-3" aria-label="Practice style">
      <div className="min-w-0 flex-1">
        <p className="font-medium">New: levels, effort points and achievements</p>
        <p className="text-meta text-muted-foreground">
          They reward practising, never how your voice sounds. Prefer it calm? You can switch any time in Settings.
        </p>
      </div>
      <Button onClick={() => update({ styleChosen: true, practiceStyle: "playful" })}>Keep it playful</Button>
      <Button variant="outline" onClick={() => update({ styleChosen: true, practiceStyle: "calm" })}>Choose calm</Button>
    </Panel>
  );
}

/** Shown when the game layer exists, after setup, to people with a finished session who haven't chosen yet. */
export function shouldOfferStyleChoice(p: { onboarded: boolean; styleChosen: boolean }, hasPractised: boolean, enabled: boolean): boolean {
  return enabled && p.onboarded && !p.styleChosen && hasPractised;
}
