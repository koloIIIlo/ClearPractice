import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { BookOpenText, FileText, History, MessageSquareText, type LucideIcon } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { usePreferences, useSearch } from "@/lib/ipc/queries";
import { toLocalDate } from "@/lib/phrase-schedule";
import { usePracticeStyle } from "@/features/engagement/style";
import { matchingActions, type PaletteContext } from "./palette-actions";
import { useTheme } from "./theme";
import { setZoomLevel, stepZoom, useZoomLevel } from "./zoom";
import type { SearchHit } from "@/lib/ipc/schemas";
import { PRIMARY_NAV, SETTINGS_NAV } from "./nav";

const GROUPS: { kind: SearchHit["kind"]; heading: string; icon: LucideIcon }[] = [
  { kind: "session", heading: "Sessions", icon: History },
  { kind: "phrase", heading: "Phrases", icon: BookOpenText },
  { kind: "prompt", heading: "Prompts", icon: MessageSquareText },
  { kind: "guide", heading: "Guides", icon: FileText },
];

/** Ctrl+K actions (8.10), navigation and local search over saved content (§3). */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const search = useSearch(query);
  const { preferences } = usePreferences();
  const theme = useTheme();
  const zoomLevel = useZoomLevel();
  const { playful } = usePracticeStyle();
  const context: PaletteContext = {
    navigate, preferences, playful, today: toLocalDate(new Date()),
    theme: theme.preference, setTheme: theme.setPreference,
    zoom: (direction) => setZoomLevel(stepZoom(zoomLevel, direction)),
  };

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  const q = query.trim().toLowerCase();
  const destinations = [...PRIMARY_NAV, SETTINGS_NAV].filter((n) => !q || n.label.toLowerCase().includes(q));
  const hits = q ? (search.data ?? []) : [];
  const actions = matchingActions(context, q);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search ClearPractice"
      description="Go to a page, or search sessions, phrases, prompts, and guides on this computer."
      shouldFilter={false}
    >
      <CommandInput value={query} onValueChange={setQuery} placeholder="Search sessions, phrases, prompts…" />
      <CommandList>
        <CommandEmpty>{search.isFetching ? "Searching…" : "Nothing found on this computer."}</CommandEmpty>
        {actions.length > 0 && (
          <CommandGroup heading="Actions">
            {actions.map((a) => (
              <CommandItem
                key={a.id}
                value={`action-${a.id}`}
                onSelect={() => {
                  onOpenChange(false);
                  a.run(context);
                }}
              >
                <a.icon aria-hidden />
                {a.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {destinations.length > 0 && (
          <CommandGroup heading="Go to">
            {destinations.map((n) => (
              <CommandItem key={n.id} value={`nav-${n.id}`} onSelect={() => go(n.to)}>
                <n.icon aria-hidden />
                {n.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {GROUPS.map(({ kind, heading, icon: Icon }) => {
          const items = hits.filter((h) => h.kind === kind);
          if (items.length === 0) return null;
          return (
            <CommandGroup key={kind} heading={heading}>
              {items.map((h) => (
                <CommandItem key={h.id} value={`${kind}-${h.id}`} onSelect={() => go(h.href)}>
                  <Icon aria-hidden />
                  <div className="min-w-0">
                    <div className="truncate">{h.title}</div>
                    {h.excerpt && <div className="truncate text-meta text-muted-foreground">{h.excerpt}</div>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
