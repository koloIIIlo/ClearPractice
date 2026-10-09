import { useEffect } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useIpc } from "@/lib/ipc";
import { usePreferences } from "@/lib/ipc/queries";
import { toLocalDate } from "@/lib/phrase-schedule";

const KEY = "cp-reminded-on";

/** Whether the reminder is due: past the chosen time, not yet shown today, nothing practised today. */
export function reminderDue(now: Date, time: string | null, remindedOn: string | null, practisedToday: boolean): boolean {
  if (!time || practisedToday) return false;
  const today = toLocalDate(now);
  if (remindedOn === today) return false;
  const [h, m] = time.split(":").map(Number);
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
}

/**
 * Daily reminder (Settings → Practice): a quiet message inside the app at your
 * chosen time, only while the app is open, at most once a day, and only if you
 * haven't practised yet that day. No system notifications, no penalty.
 */
export function DailyReminder() {
  const ipc = useIpc();
  const navigate = useNavigate();
  const { preferences } = usePreferences();
  const time = preferences.reminderTime;
  useEffect(() => {
    if (!time) return;
    let cancelled = false;
    const check = async () => {
      let remindedOn: string | null = null;
      try { remindedOn = localStorage.getItem(KEY); } catch { /* storage unavailable: remind at most once per run */ }
      const now = new Date();
      if (!reminderDue(now, time, remindedOn, false)) return;
      const sessions = await ipc.listSessions({}).catch(() => []);
      const today = toLocalDate(now);
      const practised = sessions.some((s) => s.localDate === today && s.attemptCount > 0);
      if (cancelled || !reminderDue(now, time, remindedOn, practised)) return;
      try { localStorage.setItem(KEY, today); } catch { /* ignore */ }
      toast("Time for today's practice", {
        description: "Five or thirteen minutes, whichever suits you today.",
        action: { label: "Open Today", onClick: () => navigate("/") },
        duration: 15_000,
      });
    };
    void check();
    const timer = setInterval(() => void check(), 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [ipc, navigate, time]);
  return null;
}
