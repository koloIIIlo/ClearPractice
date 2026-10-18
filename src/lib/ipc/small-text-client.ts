/** Loaded only when a small-text screen requests a local preview or sends one. */
import { invoke } from "@tauri-apps/api/core";
import { IpcError, type IpcClient } from "./client";
import * as S from "./schemas-small-text";

export type SmallTextClient = Pick<IpcClient, "previewPhraseSuggestionsLocal" | "sendPhraseSuggestionsLocal" | "previewClipNamesLocal" | "sendClipNamesLocal" | "previewClipPicksLocal" | "sendClipPicksLocal">;

async function call<T>(name: string, schema: { parse(value: unknown): T }, args: Record<string, unknown>): Promise<T> {
  try { return schema.parse(await invoke(name, args)); }
  catch (error) { if (error instanceof Error) throw error; throw new IpcError("recording_failed", typeof error === "string" ? error : "The local model request failed."); }
}

export const nativeSmallText: SmallTextClient = {
  previewPhraseSuggestionsLocal: (sessionIds, model) => call("preview_phrase_suggestions_local", S.CoachingPreview, S.PhraseInput.parse({ sessionIds, model: model ?? null })),
  sendPhraseSuggestionsLocal: (requestId, payloadSha256) => call("send_phrase_suggestions_local", S.PhraseSuggestion.array(), S.Approval.parse({ requestId, payloadSha256 })),
  previewClipNamesLocal: (texts, model) => call("preview_clip_names_local", S.CoachingPreview, S.NamesInput.parse({ texts, model: model ?? null })),
  sendClipNamesLocal: (requestId, payloadSha256) => call("send_clip_names_local", S.ClipName.array(), S.Approval.parse({ requestId, payloadSha256 })),
  previewClipPicksLocal: (stagingId, { model, toneHint, wanted }) => call("preview_clip_picks_local", S.CoachingPreview, S.PicksInput.parse({ stagingId, model: model ?? null, toneHint, wanted })),
  sendClipPicksLocal: (stagingId, requestId, payloadSha256) => call("send_clip_picks_local", S.PickedClip.array(), S.PicksApproval.parse({ stagingId, requestId, payloadSha256 })),
};
