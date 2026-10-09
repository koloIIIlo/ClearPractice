import { Link } from "react-router";
import { HardDrive } from "lucide-react";
import { useServiceStatus } from "@/lib/ipc/queries";
import type { ServiceStatus } from "@/lib/ipc/schemas";

const STATE_TEXT = { ready: "ready", needs_setup: "needs setup", unavailable: "unavailable", busy: "working" } as const;

function transcriptionLabel(t: ServiceStatus["transcription"]) {
  if (t.mode === "off") return "Off";
  if (t.mode === "api") return `Cloud${t.model ? ` (${t.model})` : ""}`;
  return `Local${t.model ? ` (${t.model})` : ""}`;
}

function coachingLabel(c: ServiceStatus["coaching"]) {
  if (c.mode === "off") return "Off";
  if (c.mode === "local_llm") return "Local LLM";
  return c.providerLabel ? `API · ${c.providerLabel}` : "API";
}

/**
 * Where data is kept vs. where processing happens are shown separately:
 * local storage is never presented as proof that all processing is local (§6 Today).
 */
export function ServiceStatusLine() {
  const { data } = useServiceStatus();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <HardDrive aria-hidden className="size-3.5" />
        Saved on this computer
      </span>
      {data && (
        <>
          <Link to="/settings/transcription" className="hover:text-foreground hover:underline">
            Transcription: {transcriptionLabel(data.transcription)}
            {data.transcription.state !== "ready" && ` · ${STATE_TEXT[data.transcription.state]}`}
          </Link>
          <Link to="/settings/coaching" className="hover:text-foreground hover:underline">
            Coaching: {coachingLabel(data.coaching)}
            {data.coaching.mode !== "off" && data.coaching.state !== "ready" && ` · ${STATE_TEXT[data.coaching.state]}`}
          </Link>
        </>
      )}
    </div>
  );
}
