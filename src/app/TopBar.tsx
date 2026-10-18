import { WHATS_NEW_EVENT } from "@/lib/app-version";
import { Fragment, type ReactNode } from "react";
import { Link, useLocation, useMatches, useNavigate, useNavigation, type Params } from "react-router";
import { ArrowLeft, CircleHelp, Compass, Keyboard, Search } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTour } from "@/features/tour/tour";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { WindowControls } from "./WindowControls";
import { TranscriptionQueueStatus } from "@/features/transcription/QueueStatus";
import { useIpc } from "@/lib/ipc";
import { cn } from "@/lib/utils";

/** Routes declare their breadcrumb label through `handle.crumb` (see routes.tsx). */
export interface RouteHandle {
  crumb?: (params: Params) => ReactNode;
}

function Breadcrumbs() {
  const matches = useMatches();
  const crumbs = matches
    .filter((m) => (m.handle as RouteHandle | undefined)?.crumb)
    // An index child repeats its parent's path; keep one crumb per URL.
    .filter((m, i, all) => all.findIndex((o) => o.pathname === m.pathname) === i)
    .map((m) => ({ key: m.id, to: m.pathname, label: (m.handle as RouteHandle).crumb!(m.params) }));

  return (
    <Breadcrumb>
      <BreadcrumbList className="text-meta">
        {crumbs.map((c, i) => (
          <Fragment key={c.key}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem className="max-w-[16rem] truncate">
              {i === crumbs.length - 1 ? (
                <BreadcrumbPage className="truncate">{c.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link to={c.to}>{c.label}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/** Help: the guided tour and the keyboard shortcuts. */
function HelpMenu({ onOpenShortcuts }: { onOpenShortcuts: () => void }) {
  const tour = useTour();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-tour="help" variant="ghost" size="icon-sm" aria-label="Help" title="Help">
          <CircleHelp aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => tour.start()}>
          <Compass aria-hidden /> Guided tour
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => window.dispatchEvent(new Event(WHATS_NEW_EVENT))}>
          What's new
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenShortcuts}>
          <Keyboard aria-hidden /> Keyboard shortcuts <span className="ml-auto text-muted-foreground">?</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Back to the previous page (user request 2026-10-10); the mouse's back button and Alt+← do the same. */
function BackButton() {
  const navigate = useNavigate();
  useLocation(); // re-render on navigation, so the disabled state follows the history
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  return (
    <Button variant="ghost" size="icon-sm" disabled={!canGoBack} onClick={() => navigate(-1)} aria-label="Back" title="Back (Alt+←)" aria-keyshortcuts="Alt+ArrowLeft">
      <ArrowLeft aria-hidden />
    </Button>
  );
}

/**
 * The top bar doubles as the window's title bar in the desktop app (no system
 * frame): its empty space drags the window, a double-click maximizes, and the
 * window controls sit at its right edge, all in the current theme.
 */
export function TopBar({ onOpenSearch, onOpenShortcuts, showNavToggle = true }: { onOpenSearch: () => void; onOpenShortcuts: () => void; showNavToggle?: boolean }) {
  // The window controls reach the right edge; the browser preview keeps the usual padding.
  const framed = useIpc().recordingMode === "native";
  return (
    <header
      data-tauri-drag-region
      className={cn("sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 pl-4 backdrop-blur supports-[backdrop-filter]:bg-background/80", !framed && "pr-4")}
    >
      {showNavToggle && <SidebarTrigger className="-ml-1" aria-label="Toggle navigation" />}
      <BackButton />
      {/* Breadcrumb renders its own labelled nav landmark. */}
      <div data-tauri-drag-region className="flex h-full min-w-0 flex-1 items-center">
        <Breadcrumbs />
      </div>
      <TranscriptionQueueStatus />
      <HelpMenu onOpenShortcuts={onOpenShortcuts} />
      <Button
        variant="outline"
        size="sm"
        onClick={onOpenSearch}
        className="gap-2 text-muted-foreground"
        aria-keyshortcuts="Control+K"
      >
        <Search aria-hidden />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-sans text-meta sm:inline">Ctrl K</kbd>
      </Button>
      <WindowControls />
      <RouteProgress />
    </header>
  );
}

/**
 * While a page's code loads on its first visit (roadmap 7.1), a thin bar along
 * the bottom edge; still under reduced motion. The page change itself is
 * announced as before, so the bar is hidden from assistive technology.
 */
function RouteProgress() {
  const loading = useNavigation().state === "loading";
  if (!loading) return null;
  return (
    <div aria-hidden data-testid="route-progress" className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden">
      <div className="h-full w-1/3 animate-route-progress bg-primary motion-reduce:w-full motion-reduce:animate-none" />
    </div>
  );
}
