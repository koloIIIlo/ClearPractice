import type { NavigateFunction } from "react-router";
import { BookOpenText, Compass, MessageSquareHeart, Mic, Monitor, Moon, Play, Sun, ZoomIn, ZoomOut, Search, type LucideIcon } from "lucide-react";
import { EXERCISE_IDS } from "@/content/exercises";
import { loadSequence, startSequence, stepUrl } from "@/features/practice/sequence";
import { PLAN_STEPS } from "@/lib/today-plan";
import type { Preferences } from "@/lib/ipc/schemas";
import type { ThemePreference } from "./theme";

/** Features that arrive with later milestones; their actions stay hidden until then. */
export const PALETTE_FEATURES = { journey: true, justAMinute: false, conversation: false };

export type PaletteContext = {
  navigate: NavigateFunction;
  preferences: Preferences;
  theme: ThemePreference;
  setTheme: (t: ThemePreference) => void;
  zoom: (direction: 1 | -1 | 0) => void;
  /** Playful style shows the game layer (7.5). */
  playful: boolean;
  today: string;
  features?: typeof PALETTE_FEATURES;
};

export type PaletteAction = {
  id: string;
  label: string;
  keywords: string[];
  icon: LucideIcon;
  group: "Actions";
  visible: (ctx: PaletteContext) => boolean;
  run: (ctx: PaletteContext) => void;
};

const always = () => true;
const features = (ctx: PaletteContext) => ctx.features ?? PALETTE_FEATURES;

/**
 * Ctrl+K does things, not only finds things (roadmap 8.10). Each action runs
 * by keyboard alone and closes the palette.
 */
export const PALETTE_ACTIONS: PaletteAction[] = [
  {
    id: "start-practice", label: "Start today's practice", keywords: ["sequence", "session", "begin", "resume"], icon: Play, group: "Actions", visible: always,
    run: (ctx) => {
      // Resumes today's sequence when one is under way, as Today does.
      const state = loadSequence(ctx.today) ?? startSequence(ctx.today, ctx.preferences.sessionLength, PLAN_STEPS[ctx.preferences.sessionLength]);
      ctx.navigate(stepUrl(state.steps[state.index], state.localDate), { state: { section: "today" } });
    },
  },
  { id: "quick-take", label: "Record a quick take", keywords: ["record", "studio", "take", "microphone"], icon: Mic, group: "Actions", visible: always, run: (ctx) => ctx.navigate(`/practice/${EXERCISE_IDS.repeat}`) },
  { id: "review-phrases", label: "Review due phrases", keywords: ["phrases", "recall", "cards"], icon: BookOpenText, group: "Actions", visible: always, run: (ctx) => ctx.navigate("/phrases?review=1") },
  { id: "reflection", label: "Add a real-conversation reflection", keywords: ["conversation", "transfer", "listener", "reflect"], icon: MessageSquareHeart, group: "Actions", visible: always, run: (ctx) => ctx.navigate("/progress?view=real") },
  { id: "theme-light", label: "Use the light theme", keywords: ["theme", "appearance", "bright"], icon: Sun, group: "Actions", visible: (ctx) => ctx.theme !== "light", run: (ctx) => ctx.setTheme("light") },
  { id: "theme-dark", label: "Use the dark theme", keywords: ["theme", "appearance", "night"], icon: Moon, group: "Actions", visible: (ctx) => ctx.theme !== "dark", run: (ctx) => ctx.setTheme("dark") },
  { id: "theme-system", label: "Follow the Windows theme", keywords: ["theme", "appearance", "system"], icon: Monitor, group: "Actions", visible: (ctx) => ctx.theme !== "system", run: (ctx) => ctx.setTheme("system") },
  { id: "zoom-in", label: "Zoom in", keywords: ["bigger", "larger", "text size"], icon: ZoomIn, group: "Actions", visible: always, run: (ctx) => ctx.zoom(1) },
  { id: "zoom-out", label: "Zoom out", keywords: ["smaller", "text size"], icon: ZoomOut, group: "Actions", visible: always, run: (ctx) => ctx.zoom(-1) },
  { id: "zoom-reset", label: "Reset zoom", keywords: ["100", "actual size", "text size"], icon: Search, group: "Actions", visible: always, run: (ctx) => ctx.zoom(0) },
  { id: "journey", label: "Open Journey", keywords: ["levels", "game", "progress"], icon: Compass, group: "Actions", visible: (ctx) => ctx.playful && features(ctx).journey, run: (ctx) => ctx.navigate("/journey") },
  { id: "just-a-minute", label: "Play Just a Minute", keywords: ["drill", "game", "minute"], icon: Play, group: "Actions", visible: (ctx) => features(ctx).justAMinute, run: (ctx) => ctx.navigate("/drills/jam") },
  { id: "conversation", label: "Start a conversation", keywords: ["ai", "partner", "talk"], icon: MessageSquareHeart, group: "Actions", visible: (ctx) => features(ctx).conversation, run: (ctx) => ctx.navigate("/conversation") },
];

/** Actions shown for this query: all visible ones when it is empty, else those whose label or keywords match. */
export function matchingActions(ctx: PaletteContext, query: string): PaletteAction[] {
  const q = query.trim().toLowerCase();
  return PALETTE_ACTIONS.filter((a) => a.visible(ctx) && (!q || a.label.toLowerCase().includes(q) || a.keywords.some((k) => k.includes(q))));
}
