import { scenarioById, scenarioText } from "@/content/scenarios";
import { QueueContext, type Queue } from "@/features/transcription/queue";
import type { IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { ConversationMode, NewConversation, Preferences } from "@/lib/ipc/schemas";
import { renderWithRouter } from "@/test/render";
import { ConversationPage } from "./ConversationPage";

/** A job interview conversation in this mode, with the scripted lines in a fixed order. */
export const conversationInput = (mode: ConversationMode, over: Partial<NewConversation> = {}): NewConversation => ({
  scenarioId: "job-interview",
  personaId: "interviewer",
  pressure: 1,
  mode,
  modelId: mode === "api" ? "gpt-6-luna" : null,
  autoSendLocal: false,
  maxCostMicroUsd: mode === "api" ? 50_000 : null,
  scenario: scenarioText(scenarioById("job-interview")!, "interviewer", { random: () => 0 }),
  ...over,
});

/** The preview client with a stored OpenAI key, and these preferences. */
export async function partnerClient(prefs: Partial<Preferences> = {}): Promise<IpcClient> {
  const client = createMockClient();
  client.getApiKeyStatus = async () => ({ provider: "OpenAI", present: true });
  await client.setPreferences({ ...(await client.getPreferences()), ...prefs });
  return client;
}

/** A transcription queue that is ready, as with local Whisper set up (spoken answers). */
export const READY_QUEUE: Queue = { current: null, waiting: [], done: 0, failed: 0, total: 0, available: true, unavailableReason: null, enqueue: () => 1, cancel: () => {}, busySession: () => false };

/** The conversation screen at /partner/:id, with a data router (the recorder guard needs one). */
export function renderConversation(client: IpcClient, id: string, query = "", queue: Queue | null = null) {
  return renderWithRouter(
    [
      { path: "/partner/:conversationId", element: <QueueContext.Provider value={queue}><ConversationPage /></QueueContext.Provider> },
      { path: "/partner", element: <p>Partner hub</p> },
      { path: "*", element: <p>Elsewhere</p> },
    ],
    { client, path: `/partner/${id}${query}` },
  );
}
