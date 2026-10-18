import { useEffect } from "react";
import { Link } from "react-router";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { WHATS_NEW } from "@/content/whats-new";
import { APP_VERSION } from "@/lib/app-version";
import { usePreferences } from "@/lib/ipc/queries";
export function WhatsNew({ onClose }: { onClose: () => void }) {
  const { preferences, loaded, update } = usePreferences();
  // Mark seen only after the lazy UI loaded successfully and was displayed.
  useEffect(() => {
    if (loaded && preferences.lastSeenVersion !== APP_VERSION) update({ lastSeenVersion: APP_VERSION });
  }, [loaded, preferences.lastSeenVersion, update]);
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>What's new</DialogTitle><DialogDescription>ClearPractice {APP_VERSION}</DialogDescription></DialogHeader>
      <ul className="space-y-4">{WHATS_NEW[APP_VERSION]?.map((h) => <li key={h.linkLabel}>
        <p>{h.text}</p><Link className="inline-flex min-h-10 items-center underline" to={h.href} onClick={onClose}>{h.linkLabel}</Link>
      </li>)}</ul>
      <Button onClick={onClose}>Done</Button>
    </DialogContent>
  </Dialog>;
}
