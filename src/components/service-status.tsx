import { Link } from "react-router";
import { HardDrive } from "lucide-react";
import { useServiceStatus } from "@/lib/ipc/queries";
import type { ServiceStatus } from "@/lib/ipc/schemas";

const STATE_TEXT = { ready: "Ready", needs_setup: "Needs setup", unavailable: "Unavailable", busy: "Working" } as const;

/** Plain words here; the model name lives in Settings (and in the tooltip). */
function transcriptionLabel(t: ServiceStatus["transcription"]) {
  if (t.mode === "off") return "Off";
  if (t.mode === "api") return `Cloud${t.model ? ` (${t.model})` : ""}`; // the provider, e.g. AssemblyAI
  return "On this computer";
}

/** Only a state that needs attention stands out; a ready service stays quiet grey text (§3.4). */
function StateChip({ state }: { state: keyof typeof STATE_TEXT }) {
  if (state === "ready") return null;
  return (
    <span className="ml-1.5 inline-flex h-5 items-center rounded-md bg-highlight px-1.5 font-medium whitespace-nowrap text-highlight-foreground">
      {STATE_TEXT[state]}
    </span>
  );
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
          <Link to="/settings/transcription" title={data.transcription.model ?? undefined} className="inline-flex items-center hover:text-foreground hover:underline">
            Transcription: {transcriptionLabel(data.transcription)}
            <StateChip state={data.transcription.state} />
          </Link>
          <Link to="/settings/coaching" className="inline-flex items-center hover:text-foreground hover:underline">
            Coaching: {coachingLabel(data.coaching)}
            {data.coaching.mode !== "off" && <StateChip state={data.coaching.state} />}
          </Link>
        </>
      )}
    </div>
  );
}
