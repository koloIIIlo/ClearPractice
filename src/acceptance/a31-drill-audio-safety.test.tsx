/**
 * A-31: timed drills never lose audio. The drill studio uses the shared
 * recorder, so a round that stops at its limit is saved exactly once, leaving
 * while speaking asks first, and an interrupted take waits to be recovered.
 * The manual half (kill the app at 0:30 of Just a Minute) is in the M10 spec.
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { controlledRecording, renderDrill } from "@/test/drill-harness";

afterEach(() => vi.useRealTimers());

async function speaking(path: string, think: number) {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const rec = controlledRecording();
  const view = renderDrill(path, rec.client);
  const start = await screen.findByRole("button", { name: "Start round" }, { timeout: 8_000 });
  await waitFor(() => expect(start).toBeEnabled());
  await userEvent.click(start);
  act(() => vi.advanceTimersByTime(think * 1000));
  await waitFor(() => expect(rec.client.startRecording).toHaveBeenCalledTimes(1));
  return { ...rec, ...view };
}

it("A-31 a round that stops at its limit is saved exactly once", async () => {
  const { client, tick } = await speaking("/drill/jam?seed=a31", 5);
  for (const ms of [20_000, 59_000, 60_000, 60_050, 60_200]) act(() => tick(ms));
  await waitFor(() => expect(client.stopRecording).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole("heading", { level: 2, name: "Just a Minute" }, { timeout: 5_000 })).toBeInTheDocument();
  expect(client.stopRecording).toHaveBeenCalledTimes(1);
});

it("A-31 leaving while speaking asks first, and Stop and save keeps the take", async () => {
  const { client, tick, router } = await speaking("/drill/jam?seed=a31", 5);
  act(() => tick(25_000));
  await act(() => router.navigate("/elsewhere"));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText("A take is still recording")).toBeInTheDocument();
  expect(client.stopRecording).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Stop and save" }));
  await waitFor(() => expect(client.stopRecording).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("Somewhere else")).toBeInTheDocument();
});

it("A-31 an interrupted take is offered for recovery in the drill studio", async () => {
  const { client } = controlledRecording();
  const native = {
    ...client,
    recordingMode: "native" as const,
    listRecordings: async () => [],
    listRecoverableRecordings: async () => [{ attemptId: "interrupted-1", title: "Just a Minute: Your morning routine", createdAtMs: Date.now(), durationMs: 30_000, unavailableReason: null }],
  };
  renderDrill("/drill/jam?seed=a31", native);
  expect(await screen.findByRole("heading", { name: "Interrupted takes" }, { timeout: 8_000 })).toBeInTheDocument();
  expect(screen.getByText(/Just a Minute: Your morning routine · 0:30/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Recover take" })).toBeEnabled();
});
