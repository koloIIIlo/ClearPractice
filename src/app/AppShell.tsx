import { useEffect, useState } from "react";
import { Outlet, ScrollRestoration } from "react-router";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { CommandPalette } from "./CommandPalette";
import { TopBar } from "./TopBar";
import { useIpc } from "@/lib/ipc";
import { RecoveryNotice } from "./RecoveryNotice";

export function AppShell() {
  const ipc = useIpc();
  const [searchOpen, setSearchOpen] = useState(false);

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
      <AppSidebar />
      <SidebarInset>
        <TopBar onOpenSearch={() => setSearchOpen(true)} />
        {ipc.recordingMode !== "native" && (
          <p role="note" className="border-b px-4 py-2 text-meta text-muted-foreground">Browser preview with sample data. Open the desktop app for real recording.</p>
        )}
        <RecoveryNotice />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          <Outlet />
        </main>
      </SidebarInset>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <ScrollRestoration />
    </SidebarProvider>
  );
}
