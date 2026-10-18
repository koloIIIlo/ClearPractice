export type ReleaseHighlight = { text: string; href: string; linkLabel: string };
/** Add one entry for each shipped version; keep past release notes. */
export const WHATS_NEW: Record<string, ReleaseHighlight[]> = {
  "0.1.0": [
    { text: "Short drills, guided programmes and repeat practice give you more ways to practise.", href: "/exercises?tab=drills", linkLabel: "Explore drills" },
    { text: "Optional Journey celebrates practice effort. Calm style keeps practice quiet.", href: "/settings/practice", linkLabel: "Choose your practice style" },
    { text: "Prepare for a real event with an outline, cue cards and rehearsals.", href: "/events", linkLabel: "Prepare for an event" },
    { text: "Club mode adds a shared timing light and counters, without recording anyone.", href: "/club", linkLabel: "Open Club mode" },
    { text: "Surprise prompts are off until you choose a window and days. Windows notifications need a separate opt-in.", href: "/settings/practice", linkLabel: "See surprise prompt settings" },
    { text: "Optional first-language practice ideas now appear in Guides. The draft tips await speaker review.", href: "/exercises?tab=guides", linkLabel: "Read Guides" },
  ],
};
