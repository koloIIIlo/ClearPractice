import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { IntonationContour, ReferenceClip } from "@/lib/ipc/schemas";
import { describeEnding, endingChange, ImitationOverlay, linePaths, relativeSemitones, voicedSpan } from "./ImitationOverlay";

const contour = (f0: (number | null)[], median: number | null = null): IntonationContour => ({
  algorithm: "yin-v1", source: "Estimated", hopMs: 10, sampleRate: 16_000, f0Hz: f0, rmsDb: f0.map((v) => (v ? -20 : null)),
  medianF0Hz: median, rangeSemitones: null, loudnessRangeDb: null, unavailableReason: null,
});
// 0.2 s silence, 1 s steady at 200 Hz, then the last 0.3 s falling to 150 Hz.
const falling = [...Array(20).fill(null), ...Array(100).fill(200), ...Array.from({ length: 30 }, (_, i) => 200 - (50 * i) / 29)];

it("measures each voice against its own median, finds the voiced span and the ending", () => {
  const semis = relativeSemitones(contour(falling, 200));
  expect(semis[0]).toBeNull();
  expect(semis[20]).toBeCloseTo(0);
  expect(voicedSpan(semis)).toEqual([20, 149]);
  const end = endingChange(semis, 10)!;
  expect(end).toBeLessThan(-3);
  expect(describeEnding(end)).toMatch(/^falls \d\.\d st$/);
  expect(describeEnding(0.4)).toBe("stays level (+0.4 st)");
  expect(describeEnding(2)).toBe("rises 2.0 st");
  expect(describeEnding(null)).toBe("not enough voicing to say");
  expect(voicedSpan([null, null])).toBeNull();
  // Gaps break the line instead of drawing through silence.
  expect(linePaths([0, 1, null, 2], (i) => i, (v) => v)).toEqual(["M0.0,0.0 L1.0,1.0", "M3.0,2.0"]);
});

it("draws the clip and the take, describes both endings in words and never scores", async () => {
  const user = userEvent.setup();
  const clip: ReferenceClip = { id: "voa-1", origin: "bundled", title: "Jack Frost", source: "VOA", transcript: null, durationMs: 15_000, sha256: "a".repeat(64), createdAtMs: 1 };
  const client: IpcClient = {
    ...createMockClient(),
    recordingMode: "native",
    getClipProsody: async () => contour(falling, 200),
    getTakeProsody: async () => contour([...Array(10).fill(null), ...Array(200).fill(120), ...Array.from({ length: 30 }, (_, i) => 120 + i)], 120),
  };
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><ImitationOverlay clip={clip} takeAssetId="take-1" /></IpcContext.Provider></QueryClientProvider>);
  const figure = await screen.findByRole("img");
  expect(figure.getAttribute("aria-label")).toMatch(/Reference falls .* your take rises/);
  expect(screen.getByText(/Clip: ends falls/)).toBeInTheDocument();
  expect(screen.getByText(/Your latest take: ends rises/)).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/score:|\d+ ?%|grade|correct/i);
  await user.click(screen.getByRole("switch", { name: "Stretch my take to the clip's length" }));
  expect(screen.getByRole("switch", { name: "Stretch my take to the clip's length" })).toBeChecked();
});
