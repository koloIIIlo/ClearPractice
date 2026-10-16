import { useImperativeHandle } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";
import type { AudioPlayerHandle } from "@/components/audio-player";
import type { IpcClient } from "@/lib/ipc";

/** A stand-in player: records what A/B listening asks of it and shows its gain. */
const players = vi.hoisted(() => new Map<string, { play: Mock<() => void>; seek: Mock<(ms: number) => void>; position: number }>());
vi.mock("@/components/audio-player", () => ({
  AudioPlayer: ({ src, label, volume, ref }: { src: string; label: string; volume?: number; ref?: React.Ref<AudioPlayerHandle> }) => {
    const fake = players.get(src) ?? { play: vi.fn(), seek: vi.fn(), position: 0 };
    players.set(src, fake);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useImperativeHandle(ref, () => ({ play: fake.play, pause: () => {}, seek: fake.seek, isPlaying: () => false, positionMs: () => fake.position, playRange: () => {} }));
    return <div data-testid={`player-${src}`} data-volume={volume?.toFixed(3)} aria-label={label} />;
  },
}));

// The suite runs with --isolate=false: load fresh copies that see the mock, and
// the render helper from the same module graph so they share the IPC context.
vi.resetModules();
const { AbListen, blindOrder, matchGains, rmsFromPeaks } = await import("./AbListen");
const { renderWithApp } = await import("@/test/render");
const { createMockClient } = await import("@/lib/ipc/mock-client");

const waveform = (attemptId: string, level: number) => ({ version: 1, assetId: attemptId, sha256: "a".repeat(64), sampleRate: 48_000, durationMs: 60_000, samplesPerPeak: 480, peaks: Array(100).fill(level) });

function client(over: Partial<IpcClient> = {}): IpcClient {
  return {
    ...createMockClient(),
    recordingMode: "native",
    getRecordingPlaybackUrl: async (id) => `asset://${id}`,
    getRecordingWaveform: async (id) => waveform(id, id === "take-a" ? 20_000 : 2_000),
    getAttemptTranscript: async (attemptId) => ({ attemptId, revision: null, correction: null, job: null }),
    listComparisons: async () => [],
    saveComparison: vi.fn(async (aAttempt, bAttempt, preferred, blind) => ({ id: "cmp-1", aAttempt, bAttempt, preferred, blind, createdAt: "2026-10-16T08:00:00.000Z" })),
    setPreferredTake: vi.fn(async () => {}),
    ...over,
  };
}

const a = { attemptId: "take-a", sessionId: "s-1", label: "Take 1 · 12 Sep · 1:02" };
const b = { attemptId: "take-b", sessionId: "s-2", label: "Take 3 · 14 Oct · 0:58" };

describe("matchGains", () => {
  it("leaves equal levels and silence alone", () => {
    expect(matchGains(0.3, 0.3)).toEqual({ a: 1, b: 1 });
    expect(matchGains(0, 0.3)).toEqual({ a: 1, b: 1 });
    expect(matchGains(Number.NaN, 0.3)).toEqual({ a: 1, b: 1 });
  });

  it("turns only the louder take down, by at most 12 dB", () => {
    const six = matchGains(0.2, 0.1);
    expect(six.b).toBe(1);
    expect(six.a).toBeCloseTo(0.5, 3);
    // 20 dB apart: capped at −12 dB.
    const twenty = matchGains(0.01, 0.1);
    expect(twenty.a).toBe(1);
    expect(twenty.b).toBeCloseTo(0.2512, 3);
  });

  it("measures the speech level from the louder half of the peaks", () => {
    expect(rmsFromPeaks([])).toBe(0);
    expect(rmsFromPeaks([0, 0, 100, 100])).toBe(100);
  });

  it("keeps the blind order for a seed", () => {
    expect(blindOrder("seed-1")).toEqual(blindOrder("seed-1"));
    const orders = new Set(Array.from({ length: 20 }, (_, i) => blindOrder(`seed-${i}`).join("")));
    expect(orders).toEqual(new Set(["ab", "ba"]));
  });
});

describe("AbListen", () => {
  it("switches to the other take at the same position", async () => {
    const user = userEvent.setup();
    renderWithApp(<AbListen a={a} b={b} sessionTitle="Explain a habit" />, { client: client() });
    await screen.findByTestId("player-asset://take-b");
    await user.click(screen.getByRole("button", { name: "Play A" }));
    expect(players.get("asset://take-a")!.play).toHaveBeenCalled();
    players.get("asset://take-a")!.position = 21_000;
    await user.click(screen.getByRole("button", { name: /Switch at the same point/ }));
    expect(players.get("asset://take-b")!.seek).toHaveBeenCalledWith(21_000);
    expect(players.get("asset://take-b")!.play).toHaveBeenCalled();
  });

  it("attenuates the louder take only", async () => {
    const user = userEvent.setup();
    renderWithApp(<AbListen a={a} b={b} sessionTitle="Explain a habit" />, { client: client() });
    await waitFor(() => expect(screen.getByTestId("player-asset://take-a")).toHaveAttribute("data-volume", "0.251"));
    expect(screen.getByTestId("player-asset://take-b")).toHaveAttribute("data-volume", "1.000");
    expect(screen.getByText("So the louder take doesn't simply sound better.")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Level-matched"));
    expect(screen.getByTestId("player-asset://take-a")).toHaveAttribute("data-volume", "1.000");
  });

  it("hides labels and measures in blind mode until reveal", async () => {
    const user = userEvent.setup();
    const ipc = client();
    renderWithApp(<AbListen a={a} b={b} sessionTitle="Explain a habit" />, { client: ipc });
    await screen.findByTestId("player-asset://take-a");
    await user.click(screen.getByLabelText("Hide which is which"));
    expect(screen.queryByText(a.label)).not.toBeInTheDocument();
    expect(screen.queryByText(b.label)).not.toBeInTheDocument();
    expect(screen.getByText("Measures side by side appear after you reveal.")).toBeInTheDocument();
    const reveal = screen.getByRole("button", { name: "Reveal" });
    expect(reveal).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "X sounds clearer" }));
    const [, , preferred, blind] = vi.mocked(ipc.saveComparison).mock.calls[0];
    expect(blind).toBe(true);
    expect(["a", "b"]).toContain(preferred);
    await user.click(reveal);
    expect(screen.getByRole("status")).toHaveTextContent(/X was Take \d .*; Y was Take \d/);
    expect(screen.getByText("Measures side by side")).toBeInTheDocument();
  });

  it("saves the choice as your note", async () => {
    const user = userEvent.setup();
    const ipc = client();
    renderWithApp(<AbListen a={a} b={b} sessionTitle="Explain a habit" />, { client: ipc });
    await user.click(await screen.findByRole("radio", { name: "B" }));
    expect(ipc.saveComparison).toHaveBeenCalledWith("take-a", "take-b", "b", false);
    expect(screen.getByText("Your note")).toBeInTheDocument();
    expect(await screen.findByText("Saved as your own judgement, separate from any measures.")).toBeInTheDocument();
    // Two takes of one session use the session's preferred take instead.
    const same = client();
    renderWithApp(<AbListen a={a} b={{ ...b, sessionId: "s-1" }} sessionTitle="Explain a habit" />, { client: same });
    const choices = await screen.findAllByRole("radio", { name: "About the same" });
    await user.click(choices.at(-1)!);
    expect(same.setPreferredTake).toHaveBeenCalledWith("s-1", "same");
    expect(same.saveComparison).not.toHaveBeenCalled();
  });
});
