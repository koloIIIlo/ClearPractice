/** Sample local requests: previews are single-use and no network is involved. */
import { IpcError } from "./client";
import type { Preferences, SessionDetail } from "./schemas";
import type { SmallTextClient } from "./small-text-client";
import * as S from "./schemas-small-text";

export function createMockSmallText(host: { preferences(): Preferences; sessions(): SessionDetail[] }): SmallTextClient {
  let next = 0;
  const pending = new Map<string, { kind: string; target: string; source: string; count: number }>();
  const target = () => {
    const p = host.preferences();
    if (p.coachingMode !== "local") throw new IpcError("invalid", "Choose a local model in Settings → Coaching.");
    return `${p.localEndpoint}|${p.localModel}`;
  };
  const preview = (kind: string, text: string, count: number, source = "") => {
    const bound = target();
    const p = host.preferences();
    const requestId = `local-${kind}-${++next}`;
    pending.set(requestId, { kind, target: bound, source, count });
    return S.CoachingPreview.parse({ version: 1, requestId, payloadSha256: "0".repeat(64), recipient: `${p.localEndpoint}/v1/chat/completions`, model: p.localModel || "local",
      selectedText: text, prompt: "Small text suggestions", focus: "AI suggestion", instructions: "Sample instructions (browser preview).", maximumOutputTokens: 3072,
      estimatedMaximumCostMicroUsd: 0, priceDate: "", priceSource: "", inputUsdPerMillionTokens: "0", outputUsdPerMillionTokens: "0",
      costExplanation: "Recipient: local model on this computer · free. Browser preview: nothing is sent; never audio.", expiresAtMs: Date.now() + 300_000 });
  };
  const consume = (kind: string, requestId: string, payloadSha256: string, source = "") => {
    S.Approval.parse({ requestId, payloadSha256 });
    const p = pending.get(requestId);
    pending.delete(requestId);
    if (!p || p.kind !== kind || p.target !== target() || p.source !== source || payloadSha256 !== "0".repeat(64)) throw new IpcError("invalid", "This preview changed or was already used. Preview again.");
    return p;
  };
  return {
    previewPhraseSuggestionsLocal: async (sessionIds, model) => {
      S.PhraseInput.parse({ sessionIds, model: model ?? null });
      const chosen = sessionIds.map((id) => host.sessions().find((s) => s.id === id)).filter((s) => !!s);
      if (!chosen.length) throw new IpcError("invalid", "Choose transcribed sessions first.");
      return preview("phrases", chosen.map((s, i) => `Session ${i + 1}: ${s.title}\n${s.notes || s.prompt}`).join("\n\n"), chosen.length);
    },
    sendPhraseSuggestionsLocal: async (id, hash) => {
      consume("phrases", id, hash);
      return S.PhraseSuggestion.array().parse([{ session: 1, original: "first thing in the morning", expression: "the moment I wake up", explanation: "A natural way to say when you start your day.", example: "I check the weather the moment I wake up." }]);
    },
    previewClipNamesLocal: async (texts, model) => {
      S.NamesInput.parse({ texts, model: model ?? null });
      return preview("names", texts.map((t, i) => `${i + 1}. ${t}`).join("\n"), texts.length);
    },
    sendClipNamesLocal: async (id, hash) => {
      const p = consume("names", id, hash);
      return S.ClipName.array().parse(Array.from({ length: p.count }, (_, i) => ({ index: i + 1, title: `Practice passage ${i + 1}`, description: "Listen for the phrase endings.", feature: "endings" })));
    },
    previewClipPicksLocal: async (stagingId, options) => {
      S.PicksInput.parse({ stagingId, ...options, model: options.model ?? null });
      return preview("picks", "1. [0–10 s] A sample passage for imitation.", 1, stagingId);
    },
    sendClipPicksLocal: async (stagingId, id, hash) => {
      consume("picks", id, hash, stagingId);
      return S.PickedClip.array().parse([{ startMs: 0, endMs: 10000, text: "A sample passage for imitation.", title: "A sample passage", description: "Listen for the endings.", feature: "endings", reason: "A complete thought." }]);
    },
  };
}
