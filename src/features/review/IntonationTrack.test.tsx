import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { IntonationContour } from "@/lib/ipc/schemas";
import { contourPaths, IntonationTrack } from "./IntonationTrack";

const contour: IntonationContour = {
  algorithm: "yin-v1", source: "Estimated", hopMs: 10, sampleRate: 16_000,
  f0Hz: [100, 110, null, null, 120, 130, 140], rmsDb: [-20, -20, null, null, -22, -21, -20],
  medianF0Hz: 120, rangeSemitones: 5.8, unavailableReason: null,
};

it("breaks the line at unvoiced frames instead of drawing them as zero", () => {
  const paths = contourPaths(contour, 600, 80);
  expect(paths).toHaveLength(2);
  expect(paths[0].split(" ")).toHaveLength(2);
  expect(paths[1].split(" ")).toHaveLength(3);
  expect(paths[1].startsWith("400.0,40.0")).toBe(true); // 120 Hz is the median: centre line
  expect(contourPaths({ ...contour, medianF0Hz: null }, 600, 80)).toEqual([]);
});

it("loads on request and describes the pitch without any score", async () => {
  const user = userEvent.setup();
  const client: IpcClient = { ...createMockClient(), recordingMode: "native", getTakeProsody: vi.fn(async () => contour) };
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><IntonationTrack attemptId="take-1" /></IpcContext.Provider></QueryClientProvider>);
  expect(client.getTakeProsody).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Show intonation" }));
  expect(await screen.findByText(/median 120 Hz, range 5\.8 semitones/)).toBeInTheDocument();
  expect(screen.getByText(/gaps are unvoiced or silent/)).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/score|correct|grade/i);
});
