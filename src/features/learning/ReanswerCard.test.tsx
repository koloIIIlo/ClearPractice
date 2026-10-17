import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { BASELINE_PROMPT, PROMPTS } from "@/content/prompts";
import { StudioPage } from "@/features/practice/StudioPage";
import { withFakeToday } from "@/test/clock";
import { controlledRecording } from "@/test/drill-harness";
import { factsBuilder } from "@/test/fixtures/facts";
import { renderWithRouter } from "@/test/render";
import { TodayReanswer } from "./ReanswerCard";

const today = "2026-10-20";
const prompt = PROMPTS.find((p) => p.id !== BASELINE_PROMPT.id)!;
const routes = [
  { path: "/", element: <ul><TodayReanswer /></ul> },
  { path: "/practice/:exerciseId", element: <StudioPage /> },
];

it("opens the studio and offers the comparison after a take", async () => {
  await withFakeToday(today, async () => {
    const user = userEvent.setup();
    const { client, tick } = controlledRecording();
    const facts = factsBuilder(today).onDay(8).session({ contentId: prompt.id }).take().build();
    const first = facts.takes[0].id;
    const { router } = renderWithRouter(routes, { client: { ...client, getPracticeFacts: async () => facts } });
    expect(await screen.findByText(prompt.text)).toBeInTheDocument();
    expect(screen.getByText(/You first answered 8 days ago/)).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Answer again" }));
    expect(await screen.findByText(/no need to remember your first answer/)).toBeInTheDocument();
    expect(router.state.location.search).toContain(`reanswer=${first}`);
    expect(screen.queryByRole("link", { name: /Compare with your first answer/ })).toBeNull();
    const record = await screen.findByRole("button", { name: "Record" }, { timeout: 8_000 });
    await waitFor(() => expect(record).toBeEnabled());
    await user.click(record);
    await waitFor(() => expect(client.startRecording).toHaveBeenCalled());
    expect(client.startRecording.mock.calls[0][0].context?.contentId).toBe(prompt.id);
    act(() => tick(20_000));
    await user.click(screen.getByRole("button", { name: /Stop and save/ }));
    const compare = await screen.findByRole("link", { name: /Compare with your first answer/ });
    expect(compare).toHaveAttribute("href", `/compare?a=${first}&b=${client.stopRecording.mock.calls[0][0]}`);
  });
});

it("Not this one records the skip with no points, and that step doesn't come back", async () => {
  await withFakeToday(today, async () => {
    const user = userEvent.setup();
    const { client } = controlledRecording();
    const facts = factsBuilder(today).onDay(8).session({ contentId: prompt.id }).take().build();
    const skip = vi.spyOn(client, "skipReanswer");
    renderWithRouter(routes, { client: { ...client, getPracticeFacts: async () => facts } });
    await user.click(await screen.findByRole("button", { name: "Not this one" }));
    await waitFor(() => expect(skip).toHaveBeenCalledWith(prompt.id, 7));
    await waitFor(() => expect(screen.queryByText(prompt.text)).toBeNull());
    const events = await client.listPracticeEvents();
    expect(events.filter((e) => e.kind === "reanswer_skipped").map((e) => [e.refId, e.xp])).toEqual([[`${prompt.id}:7`, 0]]);
  });
});
