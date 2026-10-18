import { useQuery } from "@tanstack/react-query";
import { useTranscriptionQueue } from "@/features/transcription/queue";
import { useIpc } from "@/lib/ipc";
import { usePreferences } from "@/lib/ipc/queries";
import type { ConversationMode } from "@/lib/ipc/schemas";

/** Mode names as the partner's screens show them (appendix D.8). */
export const MODE_LABELS: Record<ConversationMode, string> = { api: "OpenAI", local: "Local model", scripted: "Scripted (offline)" };

export const fmtUsd = (micro: number) => `$${(micro / 1_000_000).toFixed(micro > 0 && micro < 10_000 ? 4 : 2)}`;

/**
 * Which partner modes can be used now (roadmap 13.3). Scripted always can;
 * OpenAI needs a stored key and Coaching set to OpenAI; a local model needs
 * Coaching set to the local model. Never a silent switch between them.
 */
export function usePartnerModes() {
  const ipc = useIpc();
  const { preferences } = usePreferences();
  const key = useQuery({ queryKey: ["api-key-status"], queryFn: () => ipc.getApiKeyStatus(), retry: false });
  const queue = useTranscriptionQueue();
  const apiReason =
    preferences.coachingMode !== "api" ? "Set Coaching to OpenAI in Settings to use it." : key.data?.present ? null : "Store your OpenAI key in Settings → Coaching first.";
  const localReason = preferences.coachingMode === "local" ? null : "Set Coaching to a local model in Settings to use it.";
  return {
    preferences,
    api: apiReason === null,
    apiReason,
    local: localReason === null,
    localReason,
    /** Spoken answers are transcribed on this computer; without local Whisper you type them. */
    spoken: queue.available,
    spokenReason: queue.unavailableReason,
  };
}
