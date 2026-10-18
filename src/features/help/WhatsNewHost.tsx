import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { APP_VERSION, WHATS_NEW_EVENT } from "@/lib/app-version";
import { usePreferences } from "@/lib/ipc/queries";
const WhatsNew = lazy(() => import("./WhatsNew").then((m) => ({ default: m.WhatsNew })));

/** Only this tiny check runs at start-up; UI and release content load on demand. */
export function WhatsNewHost() {
  const { preferences, loaded } = usePreferences();
  const checked = useRef(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(WHATS_NEW_EVENT, show);
    return () => window.removeEventListener(WHATS_NEW_EVENT, show);
  }, []);
  useEffect(() => {
    if (!loaded || checked.current) return;
    checked.current = true;
    if (preferences.lastSeenVersion !== APP_VERSION) setOpen(true);
  }, [loaded, preferences.lastSeenVersion]);
  return open ? <Suspense fallback={null}><WhatsNew onClose={() => setOpen(false)} /></Suspense> : null;
}
