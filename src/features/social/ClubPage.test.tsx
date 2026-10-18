import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import { renderWithApp } from "@/test/render";
import { ClubPage } from "./ClubPage";
import { ClubLight } from "./ClubLight";

it("runs speakers with keyboard shortcuts", async () => {
  const user = userEvent.setup();
  const client = createMockClient();
  const save = vi.spyOn(client, "saveClubSpeech");
  const publish = vi.spyOn(client, "publishClubLight");
  let now = 1000;
  const monotonic = vi.spyOn(performance, "now").mockImplementation(() => now);
  try {
    renderWithApp(<ClubPage />, { client, path: "/club" });
    await user.click(screen.getByRole("button", { name: "New meeting" }));
    expect(screen.getByText("Ask speakers before counting their filler words. Nothing is recorded.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Meeting title"), "Thursday club");
    await user.type(screen.getByLabelText("Word of the day"), "candid");
    await user.type(screen.getByLabelText("Speaker 1"), "Maria");
    await user.click(screen.getByRole("combobox", { name: "Kind" }));
    await user.click(screen.getByRole("option", { name: "Table topic" }));
    expect(screen.getByLabelText("Minimum (seconds)")).toHaveValue("60");
    expect(screen.getByLabelText("Maximum (seconds)")).toHaveValue("120");
    await user.clear(screen.getByLabelText("Minimum (seconds)"));
    await user.type(screen.getByLabelText("Minimum (seconds)"), "1");
    await user.clear(screen.getByLabelText("Maximum (seconds)"));
    await user.type(screen.getByLabelText("Maximum (seconds)"), "3");
    await user.click(screen.getByRole("button", { name: "Add speaker" }));
    await user.type(screen.getByLabelText("Speaker 2"), "Tom");
    await user.click(screen.getByRole("button", { name: "Run meeting" }));
    expect(await screen.findByRole("heading", { name: "Speaker 1 of 2 · Maria · Table topic (0:01–0:03)" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New topic" }));
    expect(screen.getByRole("heading", { name: "Table topic" }).parentElement?.parentElement?.querySelector('[aria-live="polite"]')).toHaveTextContent(/\S/);
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    expect(screen.getByText(/Timer running/)).toBeInTheDocument();
    now += 2000;
    await waitFor(() => expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("0:02"));
    expect(screen.getByRole("status", { name: "Timing light" })).toHaveTextContent("AMBER");
    expect(publish).toHaveBeenCalledWith({ elapsedMs: 2000, light: "amber", running: true });
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    expect(screen.getByText(/Timer stopped/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Word of the day used" }));
    await user.type(screen.getByLabelText("Notes"), "One clear point 123456 n");
    expect(screen.getByRole("button", { name: "um 0" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("Notes"), { key: "n" });
    expect(save).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "N" });
    expect(await screen.findByRole("heading", { name: /Speaker 2 of 2 · Tom/ })).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ seconds: 2, wordUsed: true, notes: "One clear point 123456 n" }));
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    now += 4000;
    fireEvent.keyDown(window, { key: "n" });
    expect(await screen.findByRole("heading", { name: "Meeting summary" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("row", { name: /Maria 0:02 AMBER/ })).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /Tom 0:04 Before green/ })).toBeInTheDocument();
    const stored = await client.listClubMeetings();
    expect(stored.find((m) => m.title === "Thursday club")).toMatchObject({ speeches: 2, timed: 2 });
    await user.click(screen.getByRole("button", { name: "Copy as text" }));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toContain("# Thursday club"));
    await user.click(screen.getByRole("button", { name: "Your meetings" }));
    await user.click(await screen.findByRole("button", { name: "Open Thursday club" }));
    expect(await screen.findByRole("heading", { name: "Meeting summary" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Your meetings" }));
    await user.click(await screen.findByRole("button", { name: "Delete Thursday club" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Open Thursday club" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Open Thursday speaking club" })).toBeInTheDocument();
  } finally { monotonic.mockRestore(); }
});

it("counts and undoes taps", async () => {
  const user = userEvent.setup();
  const client = createMockClient();
  const meeting = await client.saveClubMeeting({ title: "Monday club", localDate: "2026-10-19", wordOfTheDay: "candid", speeches: [
    { speaker: "Ana", kind: "evaluation", targetMinSeconds: 120, targetMaxSeconds: 180 },
  ] });
  const save = vi.spyOn(client, "saveClubSpeech").mockRejectedValueOnce(new Error("Could not save. Try again."));
  renderWithApp(<ClubPage />, { client, path: `/club?meeting=${meeting.meeting.id}` });
  await screen.findByRole("heading", { name: /Speaker 1 of 1 · Ana/ });
  fireEvent.keyDown(window, { key: " ", code: "Space" });
  for (const key of ["1", "1", "2", "3", "4", "5", "6"]) fireEvent.keyDown(window, { key });
  expect(screen.getByRole("button", { name: "um 2" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "other 1" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Undo last" }));
  expect(screen.getByRole("button", { name: "other 0" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "like 1" }));
  expect(screen.getByRole("button", { name: "like 2" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Undo last" }));
  expect(screen.getByRole("button", { name: "like 1" })).toBeInTheDocument();
  await user.click(screen.getByLabelText("Notes"));
  await user.keyboard("123456 n ");
  expect(screen.getByRole("button", { name: "um 2" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next speaker" }));
  expect(await screen.findByText("Could not save. Try again.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "um 2" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next speaker" }));
  await screen.findByRole("heading", { name: "Meeting summary" });
  expect(save).toHaveBeenCalledTimes(2);
  const saved = await client.getClubMeeting(meeting.meeting.id);
  expect(saved.speeches[0]).toMatchObject({ counts: { um: 2, uh: 1, so: 1, like: 1, you_know: 1 }, notes: "123456 n", wordUsed: null });
});

it("the light window shows colour and word", async () => {
  const client = createMockClient();
  const onLight = vi.spyOn(client, "onClubLight");
  const rendered = renderWithApp(<ClubLight />, { client, path: "/club/light" });
  expect(screen.getByText("Waiting for the timer…")).toBeInTheDocument();
  await waitFor(() => expect(onLight).toHaveBeenCalledTimes(1));
  await act(async () => { await onLight.mock.results[0]!.value; });
  const publisher = typeof BroadcastChannel === "undefined" ? client : createMockClient();
  for (const [light, elapsedMs] of [["green", 60000], ["amber", 90000], ["red", 120000]] as const) {
    await act(async () => { await publisher.publishClubLight({ light, elapsedMs, running: true }); });
    await waitFor(() => expect(screen.getByRole("status", { name: "Timing light" })).toHaveTextContent(light.toUpperCase()));
    expect(screen.getByRole("status", { name: "Timing light" }).style.backgroundColor).toBe(`var(--cp-light-${light})`);
  }
  expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("2:00");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  rendered.unmount();
  // Only the preview's two sample meetings: the light window saves nothing.
  expect((await client.listClubMeetings()).map((m) => m.id)).toEqual(["club-sample", "club-finished"]);
});
