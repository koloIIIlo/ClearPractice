import { lazy, Suspense, useEffect, useState } from "react";
import { Outlet, ScrollRestoration, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { ShortcutsDialog, typingTarget } from "./ShortcutsDialog";
import { setZoomLevel, stepZoom, useZoomLevel } from "./zoom";
import { TranscriptionQueueProvider } from "@/features/transcription/queue";
import { TourProvider } from "@/features/tour/tour";
import { TopBar } from "./TopBar";
import { useIpc } from "@/lib/ipc";
import { RecoveryNotice } from "./RecoveryNotice";
import { DailyReminder } from "./DailyReminder";

const CommandPalette = lazy(() => import("./CommandPalette").then((m) => ({ default: m.CommandPalette })));

/** Start-up is measured once per app run: process start → first painted screen (6.5). */
let startupMeasured = false;

export function AppShell() {
  const ipc = useIpc();
  const [searchOpen, setSearchOpen] = useState(false);
  // Mounted from the first opening on, so closing keeps its state and animation.
  const searchUsed = useSearchUsed(searchOpen);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // First-launch setup is one focused task: no app navigation around it (§3.10).
  const setup = useLocation().pathname === "/welcome";
  const navigate = useNavigate();
  const native = ipc.recordingMode === "native";
  const zoom = useZoomLevel();

  // Page zoom, remembered between runs; the browser preview leaves zoom to the browser.
  useEffect(() => {
    if (native) void ipc.setZoom(zoom).catch(() => {});
  }, [ipc, native, zoom]);
  useEffect(() => {
    if (!native) return;
    const zoomBy = (direction: 1 | -1 | 0) => {
      const next = stepZoom(zoom, direction);
      setZoomLevel(next);
      toast(`Zoom ${Math.round(next * 100)} %`, { id: "zoom", duration: 1500 });
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === "=" || e.key === "+") zoomBy(1);
      else if (e.key === "-" || e.key === "_") zoomBy(-1);
      else if (e.key === "0") zoomBy(0);
      else return;
      e.preventDefault();
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  }, [native, zoom]);

  useEffect(() => {
    if (startupMeasured || ipc.recordingMode !== "native") return;
    startupMeasured = true;
    requestAnimationFrame(() => {
      void ipc.appUptimeMs().then((ms) => ipc.recordTiming("startup", ms)).catch(() => {});
    });
  }, [ipc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (e.altKey && e.key === "ArrowLeft" && !typingTarget(e.target)) {
        e.preventDefault();
        navigate(-1);
      } else if (e.key === "?" && !e.ctrlKey && !e.altKey && !e.metaKey && !typingTarget(e.target) && !document.querySelector("[role=dialog], [role=alertdialog]")) {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <TranscriptionQueueProvider>
      <TourProvider>
        <SidebarProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("main")?.focus();
            }}
          >
            Skip to content
          </a>
          {!setup && <AppSidebar />}
          <SidebarInset>
            <TopBar onOpenSearch={() => setSearchOpen(true)} onOpenShortcuts={() => setShortcutsOpen(true)} showNavToggle={!setup} />
            {/* The one main landmark; app-wide notices sit inside it so no content is outside a landmark. */}
            <main id="main" tabIndex={-1} className="flex-1 outline-none">
              {ipc.recordingMode !== "native" && (
                <p role="note" className="border-b px-4 py-2 text-meta text-muted-foreground">Browser preview with sample data. Open the desktop app for real recording.</p>
              )}
              <RecoveryNotice />
              <DailyReminder />
              <Outlet />
            </main>
          </SidebarInset>
          {/* Its code (cmdk) loads on first use (roadmap 7.1). */}
          {searchUsed && (
            <Suspense fallback={null}>
              <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
            </Suspense>
          )}
          <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
          <ScrollRestoration />
        </SidebarProvider>
      </TourProvider>
    </TranscriptionQueueProvider>
  );
}

/** True from the first time the palette opens. */
function useSearchUsed(open: boolean): boolean {
  const [used, setUsed] = useState(open);
  useEffect(() => {
    if (open) setUsed(true);
  }, [open]);
  return used || open;
}
