import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IpcContext, IpcError } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { RecordingStatus, SavedRecording } from "@/lib/ipc/schemas";
import { useRecorder } from "./recorder";

function setup(client = createMockClient()) {
  const wrapper = ({ children }: { children: React.ReactNode }) => <IpcContext.Provider value={client}>{children}</IpcContext.Provider>;
  return { client, ...renderHook(() => useRecorder("Explain a programming concept"), { wrapper }) };
}

describe("recording lifecycle", () => {
  it("deduplicates rapid start and stop actions and keeps the verified asset", async () => {
    const client = createMockClient();
    const start = vi.spyOn(client, "startRecording");
    const stop = vi.spyOn(client, "stopRecording");
    const { result } = setup(client);
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => {
      result.current.start({ deviceId: null });
      result.current.start({ deviceId: null });
    });
    await waitFor(() => expect(result.current.phase).toBe("recording"));
    expect(start).toHaveBeenCalledTimes(1);
    await act(async () => {
      const a = result.current.stopAndSave();
      const b = result.current.stopAndSave();
      expect(a).toBe(b);
      expect(await a).toBe(true);
    });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(result.current.takes).toHaveLength(1);
    expect(result.current.phase).toBe("saved");
    expect(result.current.takes[0].asset.assetId).toBe(start.mock.calls[0][0].attemptId);
  });

  it("does not call capture or save when a countdown is cancelled", async () => {
    const { client, result } = setup();
    const start = vi.spyOn(client, "startRecording");
    const stop = vi.spyOn(client, "stopRecording");
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start({ deviceId: null, countdownSeconds: 3 }));
    expect(result.current.isCapturing).toBe(true);
    await act(async () => { expect(await result.current.stopAndSave()).toBe(true); });
    expect(result.current.phase).toBe("idle");
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it("never reports Saved or allows the save-and-leave path after a disk error", async () => {
    const client = createMockClient();
    let listener: (status: RecordingStatus) => void = () => {};
    client.onRecordingEvent = async (callback) => { listener = callback; return () => {}; };
    client.startRecording = async (request) => ({ attemptId: request.attemptId, phase: "recording", elapsedMs: 0, monotonicMs: 0, level: 0, clipping: false, error: null, asset: null });
    client.stopRecording = vi.fn(async (): Promise<SavedRecording> => { throw new IpcError("disk_full", "The disk is full. Captured chunks are kept for recovery."); });
    const { result } = setup(client);
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start({ deviceId: null }));
    await waitFor(() => expect(result.current.phase).toBe("recording"));
    const id = (client.stopRecording as ReturnType<typeof vi.fn>).mock.calls;
    expect(id).toHaveLength(0);
    await act(async () => { expect(await result.current.stopAndSave()).toBe(false); });
    expect(result.current.phase).toBe("interrupted");
    expect(result.current.takes).toHaveLength(0);
    expect(result.current.error).toContain("disk is full");
    // The event adapter may independently report interruption; it must stay unsaved.
    act(() => listener({ attemptId: "unrelated", phase: "saved", elapsedMs: 0, monotonicMs: 0, level: 0, clipping: false, error: null, asset: null }));
    expect(result.current.phase).toBe("interrupted");
  });

  it("keeps receiving level events under StrictMode, even from a client that tracks listeners by identity", async () => {
    const client = createMockClient();
    // Identity-keyed registry: registering the same function twice yields one entry.
    const listeners = new Set<(status: RecordingStatus) => void>();
    client.onRecordingEvent = async (callback) => {
      listeners.add(callback);
      return () => { listeners.delete(callback); };
    };
    let attemptId = "";
    client.startRecording = async (request) => {
      attemptId = request.attemptId;
      return { attemptId, phase: "recording", elapsedMs: 0, monotonicMs: 0, level: 0, clipping: false, error: null, asset: null };
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StrictMode><IpcContext.Provider value={client}>{children}</IpcContext.Provider></StrictMode>
    );
    const { result } = renderHook(() => useRecorder("Explain a programming concept"), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start({ deviceId: null }));
    await waitFor(() => expect(result.current.phase).toBe("recording"));

    const emit = (elapsedMs: number, level: number) =>
      act(() => listeners.forEach((l) => l({ attemptId, phase: "recording", elapsedMs, monotonicMs: elapsedMs, level, clipping: false, error: null, asset: null })));
    expect(listeners.size).toBeGreaterThan(0);
    emit(1_200, 0.1);
    emit(2_300, 0.3);
    expect(result.current.elapsedMs).toBe(2_300);
    expect(result.current.levels).toEqual([0.1, 0.3]);
    // A late duplicate (same monotonic time) neither rewinds the timer nor adds a bar.
    emit(2_300, 0.3);
    expect(result.current.levels).toHaveLength(2);
  });

  it("removes asynchronous event subscriptions when the screen is closed", async () => {
    const client = createMockClient();
    let resolve: (unsubscribe: () => void) => void = () => {};
    client.onRecordingEvent = () => new Promise((done) => { resolve = done; });
    const remove = vi.fn();
    const { unmount } = setup(client);
    unmount();
    await act(async () => resolve(remove));
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
