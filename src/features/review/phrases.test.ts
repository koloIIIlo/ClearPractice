import { expect, it } from "vitest";
import type { IntonationContour } from "@/lib/ipc/schemas";
import { phraseEndings } from "./phrases";

const base: Omit<IntonationContour, "f0Hz" | "rmsDb"> = {
  algorithm: "yin-v1", source: "Estimated", hopMs: 10, sampleRate: 16_000,
  medianF0Hz: 150, rangeSemitones: 6, loudnessRangeDb: 10, unavailableReason: null,
};
const steady = (hz: number, frames: number) => Array<number | null>(frames).fill(hz);
const glide = (from: number, to: number, frames: number) =>
  Array.from({ length: frames }, (_, i) => from * (to / from) ** (i / (frames - 1)));
const gap = (frames: number) => Array<number | null>(frames).fill(null);
const contour = (f0Hz: (number | null)[]): IntonationContour => ({ ...base, f0Hz, rmsDb: f0Hz.map((f) => (f == null ? null : -20)) });

it("splits at pauses and reads each ending as falling, rising or level", () => {
  const f0 = [
    ...steady(150, 40), ...glide(150, 110, 25), // phrase 1 falls about 5.4 semitones
    ...gap(30),
    ...steady(140, 40), ...glide(140, 190, 25), // phrase 2 rises about 5.3 semitones
    ...gap(30),
    ...steady(150, 60), // phrase 3 stays level
  ];
  const endings = phraseEndings(contour(f0));
  expect(endings.map((e) => e.direction)).toEqual(["falling", "rising", "level"]);
  expect(endings[0]).toMatchObject({ index: 1, startMs: 0, endMs: 650 });
  expect(endings[0].changeSemitones).toBeLessThan(-4);
  expect(endings[1].startMs).toBe(950);
  expect(endings[2].changeSemitones).toBe(0);
});

it("keeps short unvoiced dips inside a phrase and skips fragments too short to read", () => {
  const f0 = [...steady(150, 30), ...gap(10), ...steady(150, 30), ...gap(40), ...steady(200, 20)];
  const endings = phraseEndings(contour(f0));
  expect(endings).toHaveLength(1); // the 100 ms dip does not split; the 200 ms tail is too short
  expect(endings[0].endMs).toBe(700);
});
