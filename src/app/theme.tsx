/**
 * Appearance: light / dark / follow system, plus an in-app reduced-motion override (§6 Settings).
 * The preference is cached in localStorage so the first paint is correct;
 * from M2 it is also persisted in the profile settings in SQLite.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
  reducedMotion: boolean;
  setReducedMotion: (on: boolean) => void;
}

const STORAGE_KEY = "cp.appearance";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): { preference: ThemePreference; reducedMotion: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (["system", "light", "dark"].includes(v.preference)) {
        return { preference: v.preference, reducedMotion: !!v.reducedMotion };
      }
    }
  } catch {
    // Storage may be unavailable; fall back to defaults.
  }
  return { preference: "system", reducedMotion: false };
}

const systemDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [stored] = useState(readStored);
  const [preference, setPreferenceState] = useState<ThemePreference>(stored.preference);
  const [reducedMotion, setReducedMotionState] = useState(stored.reducedMotion);
  const [systemIsDark, setSystemIsDark] = useState(systemDark);

  useEffect(() => {
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mql) return;
    const onChange = () => setSystemIsDark(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const resolved: ResolvedTheme = preference === "system" ? (systemIsDark ? "dark" : "light") : preference;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
    root.dataset.reducedMotion = String(reducedMotion);
  }, [resolved, reducedMotion]);

  const persist = useCallback((next: { preference: ThemePreference; reducedMotion: boolean }) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Non-fatal: the preference simply won't survive a restart.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved,
      reducedMotion,
      setPreference: (p) => {
        setPreferenceState(p);
        persist({ preference: p, reducedMotion });
      },
      setReducedMotion: (on) => {
        setReducedMotionState(on);
        persist({ preference, reducedMotion: on });
      },
    }),
    [preference, resolved, reducedMotion, persist],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
