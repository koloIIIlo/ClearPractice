import { useEffect, useState } from "react";
import { useIpc } from "@/lib/ipc";
import { cn } from "@/lib/utils";

/** Thin 10 px glyphs in the style of Windows 11's caption buttons, drawn in the text colour. */
function Glyph({ kind }: { kind: "minimize" | "maximize" | "restore" | "close" }) {
  return (
    <svg aria-hidden viewBox="0 0 10 10" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="1">
      {kind === "minimize" && <path d="M0 5.5h10" />}
      {kind === "maximize" && <rect x="0.5" y="0.5" width="9" height="9" rx="1" />}
      {kind === "restore" && (
        <>
          <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
          <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
        </>
      )}
      {kind === "close" && <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />}
    </svg>
  );
}

const button = "flex h-full w-[46px] items-center justify-center text-foreground/80 transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:outline-offset-[-2px]";

/**
 * Minimize, maximize/restore and close for the custom title bar (user request
 * 2026-10-10): the window has no system frame, so the top bar is the title bar
 * and follows light and dark mode. Close still asks first while a take is recording.
 */
export function WindowControls() {
  const ipc = useIpc();
  const native = ipc.recordingMode === "native";
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let remove: (() => void) | undefined;
    const sync = () => void ipc.isWindowMaximized().then((m) => !disposed && setMaximized(m)).catch(() => {});
    sync();
    void ipc.onWindowResized(sync).then((unlisten) => (disposed ? unlisten() : (remove = unlisten))).catch(() => {});
    return () => {
      disposed = true;
      remove?.();
    };
  }, [ipc, native]);

  if (!native) return null;
  return (
    <div className="-my-px flex h-[calc(100%+2px)] shrink-0 self-stretch" role="group" aria-label="Window">
      <button type="button" className={button} aria-label="Minimize" title="Minimize" onClick={() => void ipc.minimizeWindow()}>
        <Glyph kind="minimize" />
      </button>
      <button type="button" className={button} aria-label={maximized ? "Restore" : "Maximize"} title={maximized ? "Restore" : "Maximize"} onClick={() => void ipc.toggleMaximizeWindow()}>
        <Glyph kind={maximized ? "restore" : "maximize"} />
      </button>
      <button
        type="button"
        className={cn(button, "hover:bg-window-close hover:text-on-window-close")}
        aria-label="Close"
        title="Close"
        onClick={() => void ipc.closeWindow()}
      >
        <Glyph kind="close" />
      </button>
    </div>
  );
}
