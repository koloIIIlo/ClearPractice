import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { Moment } from "@/lib/ipc/schemas";
import { renderWithApp } from "@/test/render";
import { BestMoments, reelMs } from "./BestMoments";

const moment = (attemptId: string, segment: number, text: string, startMs: number, endMs: number, liked = false): Moment =>
  ({ attemptId, sessionId: `s-${attemptId}`, ordinal: 1, revisionId: `rev-${attemptId}`, segment, text, startMs, endMs, localDate: "2026-10-16", liked });
const moments = [
  moment("t1", 3, "Short and sweet.", 10_500, 12_500, true),
  moment("t2", 0, "In the end, I realised the map I was holding was upside down.", 0, 4_000),
  moment("t1", 1, "The first thing I do is open the window, because fresh air wakes me up.", 3_500, 9_500),
];

// jsdom has no playback: record what plays and let the test move time.
let played: { src: string | null; at: number }[] = [];
beforeEach(() => {
  played = [];
  const times = new WeakMap<HTMLMediaElement, number>();
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "get").mockImplementation(function (this: HTMLMediaElement) { return times.get(this) ?? 0; });
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "set").mockImplementation(function (this: HTMLMediaElement, v: number) { times.set(this, v); });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function (this: HTMLMediaElement) { this.dispatchEvent(new Event("loadedmetadata")); });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async function (this: HTMLMediaElement) { played.push({ src: this.getAttribute("src"), at: this.currentTime }); });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** Moves the hidden player to `ms` and sends the time update. */
function timeAt(ms: number) {
  const audio = document.querySelector("audio")!;
  audio.currentTime = ms / 1000;
  fireEvent.timeUpdate(audio);
}

it("plays the reel in order and explains how sentences were picked", async () => {
  const user = userEvent.setup();
  const client: IpcClient = { ...createMockClient(), recordingMode: "native", bestMoments: async () => moments, getRecordingPlaybackUrl: async (id) => `blob:${id}` };
  renderWithApp(<BestMoments />, { client });
  const list = await screen.findByRole("list", { name: "Your best moments this week" });
  const items = within(list).getAllByRole("listitem");
  expect(items.map((i) => i.querySelector("p")?.textContent)).toEqual(moments.map((m) => `“${m.text}”`));
  expect(items[0]).toHaveTextContent("You liked this");
  expect(items[1]).toHaveTextContent("Picked: a complete sentence with no hesitation candidate");
  expect(screen.getByText(/Picked by simple rules/)).toBeInTheDocument();
  expect(reelMs(moments)).toBe(12_000);
  const playReel = await screen.findByRole("button", { name: "Play the reel (0:12)" });
  await waitFor(() => expect(playReel).toBeEnabled());
  await user.click(playReel);
  await waitFor(() => expect(played).toHaveLength(1));
  expect(played[0]).toEqual({ src: "blob:t1", at: 10.5 });
  expect(items[0]).toHaveAttribute("aria-current", "true");
  // The first sentence ends at its stored end time; the reel moves on to the next take.
  timeAt(12_500);
  await waitFor(() => expect(played).toHaveLength(2));
  expect(played[1]).toEqual({ src: "blob:t2", at: 0 });
  timeAt(4_000);
  await waitFor(() => expect(played).toHaveLength(3));
  expect(played[2]).toEqual({ src: "blob:t1", at: 3.5 });
  timeAt(9_500);
  await waitFor(() => expect(screen.getByRole("button", { name: /Play the reel/ })).toBeInTheDocument());
  expect(played).toHaveLength(3);
});

it("says plainly when there is nothing yet and never plays in the preview", async () => {
  renderWithApp(<BestMoments />, { client: { ...createMockClient(), bestMoments: async () => [] } });
  expect(await screen.findByText("No moments yet this week")).toBeInTheDocument();
});
