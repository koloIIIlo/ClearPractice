import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useIpc } from "@/lib/ipc";
import { usePreferences } from "@/lib/ipc/queries";
import { surpriseDue, SURPRISE_DAY_KEY } from "@/lib/surprise";
import { toLocalDate } from "@/lib/phrase-schedule";

export function SurpriseScheduler() {
  const ipc = useIpc();
  const navigate = useNavigate();
  const { preferences: p, loaded } = usePreferences();
  const shownThisRun = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded || !p.surpriseEnabled) return;
    let cancelled = false;
    let busy = false;
    let shown: string | null = null;
    const check = async () => {
      if (busy) return;
      const now = new Date();
      const date = toLocalDate(now);
      if (shownThisRun.current === date) return;
      try { shown = localStorage.getItem(SURPRISE_DAY_KEY) ?? shown; } catch { /* per-run fallback */ }
      if (!surpriseDue(now, p, shown, false)) return;
      busy = true;
      try {
        const [events, sessions] = await Promise.all([ipc.listPracticeEvents(date), ipc.listSessions({})]);
        const practised = events.some((e) => e.localDate === date) || sessions.some((s) => s.localDate === date && s.attemptCount > 0);
        const checkedAt = new Date();
        if (cancelled || toLocalDate(checkedAt) !== date || !surpriseDue(checkedAt, p, shown, practised)) return;
        const { showSurprisePrompt } = await import("@/features/practice/SurprisePrompt");
        if (cancelled) return;
        const dismiss = () => {
          shown = date;
          shownThisRun.current = date;
          try { localStorage.setItem(SURPRISE_DAY_KEY, date); } catch { /* per-run fallback */ }
        };
        dismiss(); // also prevents another delivery after closing or restarting the app
        const text = showSurprisePrompt(date, navigate, dismiss);
        if (p.surpriseNotifications) void ipc.showSurpriseNotification(text).catch(() => {});
      } catch { /* A failed practice check must never produce an unwanted prompt. */ }
      finally { busy = false; }
    };
    void check();
    const timer = setInterval(() => void check(), 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [ipc, navigate, p, loaded]);
  return null;
}
