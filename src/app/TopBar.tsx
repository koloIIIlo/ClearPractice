import { Fragment, type ReactNode } from "react";
import { Link, useMatches, type Params } from "react-router";
import { Search } from "lucide-react";
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

export function TopBar({ onOpenSearch, showNavToggle = true }: { onOpenSearch: () => void; showNavToggle?: boolean }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      {showNavToggle && <SidebarTrigger className="-ml-1" aria-label="Toggle navigation" />}
      {/* Breadcrumb renders its own labelled nav landmark. */}
      <div className="min-w-0 flex-1">
        <Breadcrumbs />
      </div>
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
    </header>
  );
}
