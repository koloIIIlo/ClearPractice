import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePreferences } from "@/lib/ipc/queries";

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((k) => (
        <kbd key={k} className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border bg-muted px-1.5 font-sans text-meta">
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** Every keyboard shortcut the desktop app has, in one place (opened with ? or the top bar). */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { preferences } = usePreferences();
  const rows: { keys: string[]; action: string; note?: string }[] = [
    { keys: ["Ctrl", "K"], action: "Search, or go to any page" },
    {
      keys: ["Ctrl", "Enter"],
      action: "Start or stop a take in the studio",
      note: preferences.recordingShortcuts ? undefined : "Turned off in Settings → Practice",
    },
    { keys: ["Ctrl", "B"], action: "Show or hide the sidebar" },
    { keys: ["Alt", "←"], action: "Back to the previous page (the mouse's back button works too)" },
    { keys: ["Ctrl", "+"], action: "Zoom in (Ctrl − zooms out, Ctrl 0 resets; Ctrl + mouse wheel too)" },
    { keys: ["←", "→"], action: "Move along a playback position bar (Page Up and Page Down jump further)" },
    { keys: ["Esc"], action: "Close a dialog or menu" },
    { keys: ["?"], action: "Show this list" },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-8">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Tab moves between controls everywhere; these save a few steps.</DialogDescription>
        </DialogHeader>
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.action} className="flex items-center justify-between gap-4 py-2.5">
              <span>
                {r.action}
                {r.note && <span className="block text-meta text-muted-foreground">{r.note}</span>}
              </span>
              <Keys keys={r.keys} />
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** True when a key press is meant for a text field (or a menu) rather than the app. */
export function typingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest("input, textarea, select, [contenteditable=true], [role=combobox], [role=listbox], [role=menu]");
}
