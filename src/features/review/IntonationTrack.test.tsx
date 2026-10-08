import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { IntonationContour } from "@/lib/ipc/schemas";
import { contourPaths, IntonationTrack, loudnessPaths, timeToX, xToTime } from "./IntonationTrack";
import { createPlayerLink } from "./player-link";

const contour: IntonationContour = {
  algorithm: "yin-v1", source: "Estimated", hopMs: 10, sampleRate: 16_000,
  f0Hz: [100, 110, null, null, 120, 130, 140], rmsDb: [-20, -20, null, null, -22, -21, -20],
  medianF0Hz: 120, rangeSemitones: 5.8, loudnessRangeDb: 6.2, unavailableReason: null,
};

it("breaks the line at unvoiced frames instead of drawing them as zero", () => {
  const paths = contourPaths(contour, 600, 80);
  expect(paths).toHaveLength(2);
  expect(paths[0].split(" ")).toHaveLength(2);
  expect(paths[1].split(" ")).toHaveLength(3);
  expect(paths[1].startsWith("400.0,40.0")).toBe(true); // 120 Hz is the median: centre line
  expect(contourPaths({ ...contour, medianF0Hz: null }, 600, 80)).toEqual([]);
  const loud = loudnessPaths(contour, 600, 80, 16);
  expect(loud).toHaveLength(2);
  expect(loud[0].startsWith("0.0,69.3")).toBe(true); // −20 dB sits two thirds up a 16 px band: 80 − 10.7
});

it("loads on request and describes the pitch without any score", async () => {
  const user = userEvent.setup();
  const client: IpcClient = { ...createMockClient(), recordingMode: "native", getTakeProsody: vi.fn(async () => contour) };
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><IntonationTrack attemptId="take-1" /></IpcContext.Provider></QueryClientProvider>);
  expect(client.getTakeProsody).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Show intonation" }));
  expect(await screen.findByText(/median 120 Hz, range 5\.8 semitones/)).toBeInTheDocument();
  expect(screen.getByText(/gaps are unvoiced or silent/)).toBeInTheDocument();
  expect(screen.getByText(/loudness varies by 6 dB/)).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/score|correct|grade/i);
});

it("maps time to the plot and back for the playhead and click-to-seek", () => {
  // 7 frames at 10 ms: the last frame sits at 60 ms on the right edge.
  expect(timeToX(contour, 30, 1000)).toBe(500);
  expect(timeToX(contour, 999, 1000)).toBe(1000);
  expect(xToTime(contour, 250, 1000)).toBe(15);
  expect(xToTime(contour, -5, 1000)).toBe(0);
});

it("follows the linked player and seeks it when the plot is clicked", async () => {
  const user = userEvent.setup();
  const client: IpcClient = { ...createMockClient(), recordingMode: "native", getTakeProsody: vi.fn(async () => contour) };
  const link = createPlayerLink();
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><IntonationTrack attemptId="take-1" link={link} /></IpcContext.Provider></QueryClientProvider>);
  await user.click(screen.getByRole("button", { name: "Show intonation" }));
  await screen.findByText(/median 120 Hz/);
  expect(screen.queryByTestId("intonation-playhead")).toBeNull(); // no player open yet

  const seek = vi.fn();
  act(() => { link.attach(seek); link.publish(30); });
  expect(screen.getByTestId("intonation-playhead").getAttribute("x1")).toBe("500");
  expect(screen.getByText(/click the plot to jump there/)).toBeInTheDocument();

  const plot = screen.getByTestId("intonation-plot");
  plot.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 80, right: 300, bottom: 80, x: 100, y: 0, toJSON: () => ({}) });
  fireEvent.click(plot, { clientX: 150 });
  expect(seek).toHaveBeenCalledWith(15);
});
