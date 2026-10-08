import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { MicTestFinished, RecordingStatus } from "@/lib/ipc/schemas";
import { MicrophoneTest } from "./MicrophoneTest";

const status = (level: number, monotonicMs: number): RecordingStatus => ({
  attemptId: "mic-test-1", phase: "recording", elapsedMs: monotonicMs, monotonicMs, level, clipping: false, error: null, asset: null,
});

it("records five seconds, shows the live level, then offers playback with level advice", async () => {
  const user = userEvent.setup();
  let onLevel: (s: RecordingStatus) => void = () => {};
  let onFinished: (r: MicTestFinished) => void = () => {};
  const client: IpcClient = {
    ...createMockClient(),
    recordingMode: "native",
    startMicTest: vi.fn(async () => status(0, 0)),
    getMicTestPlaybackUrl: vi.fn(async () => "asset://mic-test"),
    onMicTestEvent: async (level, finished) => { onLevel = level; onFinished = finished; return () => {}; },
  };
  render(<IpcContext.Provider value={client}><MicrophoneTest deviceId="mic-1" /></IpcContext.Provider>);
  await user.click(screen.getByRole("button", { name: "Test microphone" }));
  expect(client.startMicTest).toHaveBeenCalledWith("mic-1");
  expect(screen.getByRole("button", { name: /Recording 5 seconds/ })).toBeDisabled();
  act(() => onLevel(status(0.003, 100)));
  expect(screen.getByRole("meter")).toBeInTheDocument();
  await act(async () => onFinished({ attemptId: "mic-test-1", durationMs: 5000, error: null }));
  expect(screen.getByLabelText("Microphone test recording")).toHaveAttribute("src", "asset://mic-test");
  expect(screen.getByRole("status")).toHaveTextContent("very quiet");
  expect(screen.getByText(/isn't saved to your sessions/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Test again" }));
  act(() => onLevel(status(0.2, 100)));
  await act(async () => onFinished({ attemptId: "mic-test-1", durationMs: 5000, error: null }));
  expect(screen.getByRole("status")).toHaveTextContent("came through clearly");
});

it("reports a microphone that cannot be opened", async () => {
  const user = userEvent.setup();
  const client: IpcClient = { ...createMockClient(), recordingMode: "native",
    startMicTest: async () => { throw new Error("Stop the current recording before testing the microphone."); } };
  render(<IpcContext.Provider value={client}><MicrophoneTest deviceId={null} /></IpcContext.Provider>);
  await user.click(screen.getByRole("button", { name: "Test microphone" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Stop the current recording");
});
