import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AudioPlayer, type AudioPlayerHandle } from "./audio-player";

it("plays, pauses, seeks, skips, changes speed and stops at the end of a range", async () => {
  const user = userEvent.setup();
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async function (this: HTMLMediaElement) { this.dispatchEvent(new Event("play")); });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) { this.dispatchEvent(new Event("pause")); });
  const ref = createRef<AudioPlayerHandle>();
  render(<AudioPlayer ref={ref} src="asset://clip.wav" label="clip: Opening" speeds={[0.75, 1, 1.25]} />);
  const audio = document.querySelector("audio")!;
  Object.defineProperty(audio, "duration", { configurable: true, value: 20 });
  fireEvent.loadedMetadata(audio);
  expect(screen.getByText("/ 0:20")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Play clip: Opening" }));
  expect(play).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Pause clip: Opening" })).toBeInTheDocument();

  fireEvent.change(screen.getByRole("slider", { name: "Position in clip: Opening" }), { target: { value: "8000" } });
  expect(audio.currentTime).toBe(8);
  await user.click(screen.getByRole("button", { name: "Forward 5 seconds" }));
  expect(audio.currentTime).toBe(13);
  await user.click(screen.getByRole("button", { name: "Back 5 seconds" }));
  expect(audio.currentTime).toBe(8);
  expect(screen.getByRole("combobox", { name: "Speed of clip: Opening" })).toHaveTextContent("1×");

  // A range preview pauses at its end.
  act(() => ref.current!.playRange(2_000, 4_000));
  expect(audio.currentTime).toBe(2);
  audio.currentTime = 4.05;
  fireEvent.timeUpdate(audio);
  expect(screen.getByRole("button", { name: "Play clip: Opening" })).toBeInTheDocument();
  expect(ref.current!.positionMs()).toBeCloseTo(4_050);
  vi.restoreAllMocks();
});
