import { BookOpenText, CalendarCheck, Dumbbell, HeartHandshake, History, LineChart, Settings, Sprout, type LucideIcon } from "lucide-react";

/** The primary destinations, Journey in Playful style (roadmap 9.1), Confidence in both (12.1), plus Settings — blueprint §3. */
export interface NavItem {
  id: "today" | "exercises" | "sessions" | "phrases" | "confidence" | "progress" | "journey" | "settings";
  label: string;
  to: string;
  icon: LucideIcon;
}

export const PRIMARY_NAV: NavItem[] = [
  { id: "today", label: "Today", to: "/", icon: CalendarCheck },
  { id: "exercises", label: "Exercises", to: "/exercises", icon: Dumbbell },
  { id: "sessions", label: "Sessions", to: "/sessions", icon: History },
  { id: "phrases", label: "Phrases", to: "/phrases", icon: BookOpenText },
  { id: "confidence", label: "Confidence", to: "/confidence", icon: HeartHandshake },
  { id: "progress", label: "Progress", to: "/progress", icon: LineChart },
  { id: "journey", label: "Journey", to: "/journey", icon: Sprout },
];

export const SETTINGS_NAV: NavItem = { id: "settings", label: "Settings", to: "/settings", icon: Settings };

/**
 * Which sidebar entry is selected. Contextual screens (the practice studio)
 * keep the section the user came from, as the blueprint asks (§3).
 */
export function activeSection(pathname: string, fromSection?: unknown): NavItem["id"] {
  if (pathname.startsWith("/practice")) {
    const ids = [...PRIMARY_NAV, SETTINGS_NAV].map((n) => n.id);
    return ids.includes(fromSection as NavItem["id"]) ? (fromSection as NavItem["id"]) : "today";
  }
  const hit = [...PRIMARY_NAV, SETTINGS_NAV].find((n) => n.to !== "/" && pathname.startsWith(n.to));
  return hit?.id ?? "today";
}
