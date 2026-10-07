import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatClockTenths, loopSeekTarget, normalizeLoop, parseClock, toChannelPeaks } from "./waveform";

const fake = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  const emitter = () => {
    const listeners = new Map<string, Listener[]>();
    return {
      on: (event: string, fn: Listener) => listeners.set(event, [...(listeners.get(event) ?? []), fn]),
      emit: (event: string, ...args: unknown[]) => listeners.get(event)?.forEach((fn) => fn(...args)),
    };
  };
  const regions = { ...emitter(), list: [] as { start: number; end: number; remove: () => void; setOptions: (o: object) => void }[] };
  const plugin = {
    on: regions.on,
    enableDragSelection: vi.fn(),
    getRegions: () => regions.list,
    clearRegions: () => { regions.list = []; },
    addRegion: vi.fn((o: { start: number; end: number }) => {
      const region = { ...o, remove: () => { regions.list = regions.list.filter((r) => r !== region); regions.emit("region-removed", region); }, setOptions: (n: object) => Object.assign(region, n) };
      regions.list.push(region);
      regions.emit("region-created", region);
      return region;
    }),
  };
  const ws = { ...emitter(), setTime: vi.fn(), isPlaying: () => false, playPause: vi.fn(async () => {}), play: vi.fn(async () => {}), pause: vi.fn(), setPlaybackRate: vi.fn(), setOptions: vi.fn(), destroy: vi.fn() };
  return { plugin, ws, create: vi.fn(() => ws) };
});
vi.mock("wavesurfer.js", () => ({ default: { create: fake.create } }));
vi.mock("wavesurfer.js/plugins/regions", () => ({ default: { create: () => fake.plugin } }));

// The suite runs with --isolate=false; another file may already have loaded the
// player with the real WaveSurfer, so load a fresh copy that sees the mocks.
vi.resetModules();
const { WaveformPlayer } = await import("./WaveformPlayer");

const peaks = { version: 1, assetId: "take-1", sha256: "a".repeat(64), sampleRate: 48000, durationMs: 20_000, samplesPerPeak: 480, peaks: [0, 16384, 32767] };

describe("waveform helpers", () => {
  it("parses m:ss and plain seconds and rejects malformed times", () => {
    expect(parseClock("1:02.5")).toBe(62_500);
    expect(parseClock(" 45 ")).toBe(45_000);
    expect(parseClock("0:07")).toBe(7_000);
    expect(parseClock("1:75")).toBeNull();
    expect(parseClock("abc")).toBeNull();
    expect(parseClock("")).toBeNull();
    expect(formatClockTenths(62_540)).toBe("1:02.5");
    expect(formatClockTenths(5_000)).toBe("0:05.0");
  });

  it("orders, clamps and rejects too-short loop ranges", () => {
    expect(normalizeLoop(9_000, 3_000, 20_000)).toEqual({ startMs: 3_000, endMs: 9_000 });
    expect(normalizeLoop(-500, 99_000, 20_000)).toEqual({ startMs: 0, endMs: 20_000 });
    expect(normalizeLoop(1_000, 1_100, 20_000)).toBeNull();
  });

  it("wraps only at the loop end while playing, and starts inside the loop", () => {
    const loop = { startMs: 3_000, endMs: 9_000 };
    expect(loopSeekTarget(9_000, loop)).toBe(3_000);
    expect(loopSeekTarget(1_000, loop)).toBeNull();
    expect(loopSeekTarget(1_000, loop, true)).toBe(3_000);
    expect(loopSeekTarget(5_000, null)).toBeNull();
  });

  it("normalises native peaks into one channel", () => {
    const [channel] = toChannelPeaks(peaks);
    expect(channel[0]).toBe(0);
    expect(channel[1]).toBeCloseTo(0.5, 4);
    expect(channel[2]).toBe(1);
  });
});

describe("WaveformPlayer", () => {
  it("draws native peaks without fetching audio and loops a range typed from the keyboard", async () => {
    const user = userEvent.setup();
    render(<WaveformPlayer url="asset://take" peaks={peaks} label="Take 1" />);
    const options = (fake.create.mock.calls[0] as unknown as [{ peaks: Float32Array[]; duration: number; media: HTMLMediaElement; url?: string }])[0];
    expect(options.duration).toBe(20);
    expect(options.peaks[0]).toHaveLength(3);
    expect(options.media.getAttribute("src")).toBe("asset://take");
    expect(options.url).toBeUndefined();

    await user.type(screen.getByLabelText("Loop start"), "0:03");
    await user.type(screen.getByLabelText("Loop end"), "0:01");
    await user.click(screen.getByRole("button", { name: /Loop range/ }));
    expect(fake.plugin.addRegion).toHaveBeenCalledWith(expect.objectContaining({ start: 1, end: 3 }));
    expect(screen.getByText("Looping 0:01.0–0:03.0.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Stop looping/ }));
    expect(screen.getByText(/Drag across the waveform/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Loop start"));
    await user.type(screen.getByLabelText("Loop start"), "later");
    await user.click(screen.getByRole("button", { name: /Loop range/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter times as m:ss");
  });
});
