import { useEffect, useState } from "react";
import { Outlet, ScrollRestoration, useLocation } from "react-router";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { CommandPalette } from "./CommandPalette";
import { TopBar } from "./TopBar";
import { useIpc } from "@/lib/ipc";
import { RecoveryNotice } from "./RecoveryNotice";
import { DailyReminder } from "./DailyReminder";

/** Start-up is measured once per app run: process start → first painted screen (6.5). */
let startupMeasured = false;

export function AppShell() {
  const ipc = useIpc();
  const [searchOpen, setSearchOpen] = useState(false);
  // First-launch setup is one focused task: no app navigation around it (§3.10).
  const setup = useLocation().pathname === "/welcome";

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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
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
        <TopBar onOpenSearch={() => setSearchOpen(true)} showNavToggle={!setup} />
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
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <ScrollRestoration />
    </SidebarProvider>
  );
}
