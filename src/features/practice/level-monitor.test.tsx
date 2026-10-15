import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { InputLevel } from "@/lib/ipc/schemas";
import { useLevelMonitor } from "./level-monitor";

function Meter({ device, enabled }: { device: string | null; enabled: boolean }) {
  const { levels, level } = useLevelMonitor(device, enabled);
  return <p>{levels.length} levels, last {level}</p>;
}

it("measures the microphone only while enabled, and releases it when disabled or unmounted", async () => {
  let emit: (level: InputLevel) => void = () => {};
  const client: IpcClient = {
    ...createMockClient(),
    startLevelMonitor: vi.fn(async () => {}),
    stopLevelMonitor: vi.fn(async () => {}),
    onInputLevel: vi.fn(async (listener) => { emit = listener; return () => { emit = () => {}; }; }),
  };
  const ui = (enabled: boolean, device: string | null = "mic-1") => (
    <IpcContext.Provider value={client}><Meter device={device} enabled={enabled} /></IpcContext.Provider>
  );
  const view = render(ui(true));
  await waitFor(() => expect(client.startLevelMonitor).toHaveBeenCalledWith("mic-1"));
  await waitFor(() => expect(client.onInputLevel).toHaveBeenCalled());
  act(() => { emit({ level: 0.2, clipping: false }); emit({ level: 0.05, clipping: false }); });
  expect(screen.getByText("2 levels, last 0.05")).toBeInTheDocument();

  // Recording starts: monitoring stops and the meter clears.
  view.rerender(ui(false));
  await waitFor(() => expect(client.stopLevelMonitor).toHaveBeenCalledTimes(1));
  expect(screen.getByText("0 levels, last 0")).toBeInTheDocument();

  // Back to Ready with another microphone, then the page closes.
  view.rerender(ui(true, "mic-2"));
  await waitFor(() => expect(client.startLevelMonitor).toHaveBeenLastCalledWith("mic-2"));
  view.unmount();
  await waitFor(() => expect(client.stopLevelMonitor).toHaveBeenCalledTimes(2));
});
