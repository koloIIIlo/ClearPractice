import { expect, it } from "vitest";
import { TranscriptionResult } from "./schemas";

const known = <T>(value: T) => ({ value, unavailableReason: null });
const missing = (reason: string) => ({ value: null, unavailableReason: reason });
const fixture = () => ({
  version: 1, adapterVersion: "whisper.cpp-1.9.1-v1", provider: "local-whisper", runId: "run-1", assetId: "asset-1",
  requestId: missing("Local processing has no provider request ID"), sourceSha256: "a".repeat(64), preparedSha256: "b".repeat(64),
  modelId: "base", modelSha256: known("c".repeat(64)), language: known("en"), rawText: "Hello",
  capabilities: {segmentTimings: true, wordTimings: false, speakerLabels: false},
  segments: known([{text: "Hello", startMs: 0, endMs: 100, provenance: "Estimated"}]),
  words: missing("Word alignment has not been verified"), speakers: missing("Diarization unsupported"),
  settings: {backend: "cpu", threads: 4, prompt: null}, usage: {
    inputTokens: missing("No API token billing"), outputTokens: missing("No API token billing"),
    audioDurationMs: known(100), estimatedCostMicroUsd: known(0),
  }, createdAtMs: 1,
});

it("accepts known zero local API cost while preserving unknown token usage", () => {
  const result = TranscriptionResult.parse(fixture());
  expect(result.usage.estimatedCostMicroUsd.value).toBe(0);
  expect(result.usage.inputTokens.value).toBeNull();
  expect(result.words.value).toBeNull();
});

it("rejects unexplained missing data, unsupported alignment and backwards timings", () => {
  const source = fixture();
  expect(TranscriptionResult.safeParse({...source, language: {value: null, unavailableReason: null}}).success).toBe(false);
  expect(TranscriptionResult.safeParse({...source, words: source.segments}).success).toBe(false);
  expect(TranscriptionResult.safeParse({...source, segments: known([{text:"Hello",startMs:101,endMs:100,provenance:"Estimated"}])}).success).toBe(false);
});
