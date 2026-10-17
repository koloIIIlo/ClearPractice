import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlledRecording, renderDrill } from "@/test/drill-harness";
import { expectNoScores } from "@/test/no-scores";
import { isDrillBusy } from "./busy";

afterEach(() => vi.useRealTimers());

/** The think countdown is the recorder's own (setInterval); only that is faked. */
const fakeCountdown = () => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
const startButton = async () => {
  const button = await screen.findByRole("button", { name: "Start round" }, { timeout: 8_000 });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
};

describe("the drill clock (10.1)", () => {
  it("never records before Start round, then thinks before speaking", async () => {
    fakeCountdown();
    const { client } = controlledRecording();
    renderDrill("/drill/jam?seed=s1", client);
    const start = await startButton();
    expect(client.startRecording).not.toHaveBeenCalled();
    await userEvent.click(start);
    expect(screen.getByText("Think time")).toBeInTheDocument();
    expect(isDrillBusy()).toBe(true);
    act(() => vi.advanceTimersByTime(4_000));
    expect(client.startRecording).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1_000));
    await waitFor(() => expect(client.startRecording).toHaveBeenCalledTimes(1));
    // The take carries this round's step and the run's settings.
    const context = client.startRecording.mock.calls[0][0].context!;
    expect([context.exerciseType, context.exerciseId, context.step?.key, context.activity?.seed]).toEqual(["jam", "ex-jam", "round", "s1"]);
  });

  it("stops and saves at the limit once, writes the marks and shows the result", async () => {
    fakeCountdown();
    const { client, tick } = controlledRecording();
    renderDrill("/drill/jam?seed=s1", client);
    await userEvent.click(await startButton());
    act(() => vi.advanceTimersByTime(5_000));
    await waitFor(() => expect(client.startRecording).toHaveBeenCalled());
    act(() => tick(30_000));
    fireEvent.keyDown(window, { key: "f" });
    expect(await screen.findByRole("button", { name: "Flag a slip (1)" })).toBeInTheDocument();
    act(() => tick(59_900));
    expect(client.stopRecording).not.toHaveBeenCalled();
    act(() => tick(60_000));
    act(() => tick(60_100));
    await waitFor(() => expect(client.stopRecording).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("About 47 clean seconds", {}, { timeout: 5_000 })).toBeInTheDocument();
    expect(client.stopRecording).toHaveBeenCalledTimes(1);
    expect(client.addTakeEvents).toHaveBeenCalledWith(expect.any(String), [{ atMs: 30_000, kind: "self_flag", data: {} }]);
    expect(isDrillBusy()).toBe(false);
    expect(screen.getByRole("button", { name: "Same topic" })).toBeInTheDocument();
    expectNoScores();
  });

  it("announces time left only at 30, 10 and 5 seconds", async () => {
    fakeCountdown();
    const { client, tick } = controlledRecording();
    const { container } = renderDrill("/drill/jam?seed=s1", client);
    await userEvent.click(await startButton());
    act(() => vi.advanceTimersByTime(5_000));
    await waitFor(() => expect(client.startRecording).toHaveBeenCalled());
    const live = () => [...container.querySelectorAll("[aria-live=polite]")].map((n) => n.textContent).join(" | ");
    const heard: string[] = [];
    for (const ms of [20_000, 29_000, 30_000, 31_000, 45_000, 50_000, 51_000, 55_000, 56_000]) {
      act(() => tick(ms));
      const now = live().match(/\d+ seconds left\./)?.[0];
      if (now && heard.at(-1) !== now) heard.push(now);
    }
    expect(heard).toEqual(["30 seconds left.", "10 seconds left.", "5 seconds left."]);
  });

  it("End round stops early", async () => {
    fakeCountdown();
    const { client, tick } = controlledRecording();
    renderDrill("/drill/jam?seed=s1", client);
    await userEvent.click(await startButton());
    act(() => vi.advanceTimersByTime(5_000));
    await waitFor(() => expect(client.startRecording).toHaveBeenCalled());
    act(() => tick(12_000));
    await userEvent.click(await screen.findByRole("button", { name: "End round" }));
    await waitFor(() => expect(client.stopRecording).toHaveBeenCalledTimes(1));
  });

  it("cancels the think time without a take when you leave", async () => {
    fakeCountdown();
    const { client } = controlledRecording();
    const { router } = renderDrill("/drill/jam?seed=s1", client);
    await userEvent.click(await startButton());
    expect(isDrillBusy()).toBe(true);
    await act(() => router.navigate("/elsewhere"));
    expect(await screen.findByText("Somewhere else")).toBeInTheDocument();
    expect(screen.queryByText("A take is still recording")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(10_000));
    expect(client.startRecording).not.toHaveBeenCalled();
    expect(isDrillBusy()).toBe(false);
  });

  it("moves through the rounds of a multi-round drill and sets busy only while a round runs", async () => {
    fakeCountdown();
    const { client, tick } = controlledRecording((id) => ({ attemptId: id, definitionVersion: 1, kind: "basic", durationMs: 15_000, words: 30, speechMs: 14_000, hesitations: 1, differentPer50: 33 }));
    renderDrill("/drill/pitch?seed=s1", client);
    await userEvent.click(await screen.findByRole("button", { name: "Start" }, { timeout: 8_000 }));
    const lengths = [60, 30, 15];
    for (const [i, seconds] of lengths.entries()) {
      const start = await screen.findByRole("button", { name: i === 0 ? "Start round" : `Start round ${i + 1}` });
      await waitFor(() => expect(start).toBeEnabled());
      expect(isDrillBusy()).toBe(false);
      await userEvent.click(start);
      act(() => vi.advanceTimersByTime(i === 0 ? 10_000 : 5_000));
      await waitFor(() => expect(client.startRecording).toHaveBeenCalledTimes(i + 1));
      expect(isDrillBusy()).toBe(true);
      act(() => tick(seconds * 1000));
      await waitFor(() => expect(client.stopRecording).toHaveBeenCalledTimes(i + 1));
    }
    expect(await screen.findByRole("heading", { level: 2, name: "Elevator pitch" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Elevator pitch: /);
    expect(client.startRecording.mock.calls.map((c) => c[0].context?.step?.key)).toEqual(["r60", "r30", "r15"]);
    expect(screen.getAllByText("Did the short version keep your main point?")).toHaveLength(2);
    expect(isDrillBusy()).toBe(false);
  });
});
