import { screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import { sessions } from "@/lib/ipc/mock-data";
import { toLocalDate } from "@/lib/phrase-schedule";
import { renderWithApp } from "@/test/render";
import { CompletionPage } from "./CompletionPage";

it("records the completed sequence once", async () => {
  const base = createMockClient();
  const client = { ...base, recordSequenceCompleted: vi.fn(base.recordSequenceCompleted) };
  const ids = sessions.filter((s) => s.attemptCount > 0).slice(0, 2).map((s) => s.id);
  renderWithApp(<CompletionPage />, { client, path: "/practice/done", state: { sessionIds: ids } });
  expect(await screen.findByRole("heading", { name: "Practice complete" })).toBeInTheDocument();
  await screen.findAllByRole("link", { name: new RegExp(sessions.find((s) => s.id === ids[0])!.title) });
  await waitFor(() => expect(client.recordSequenceCompleted).toHaveBeenCalledTimes(1));
  expect(client.recordSequenceCompleted).toHaveBeenCalledWith(ids, toLocalDate(new Date()));
  const events = await client.listPracticeEvents();
  expect(events.filter((e) => e.kind === "sequence_completed")).toHaveLength(1);
});

it("records nothing without sessions", async () => {
  const base = createMockClient();
  const client = { ...base, recordSequenceCompleted: vi.fn(base.recordSequenceCompleted) };
  renderWithApp(<CompletionPage />, { client, path: "/practice/done" });
  expect(await screen.findByRole("heading", { name: "Practice complete" })).toBeInTheDocument();
  expect(client.recordSequenceCompleted).not.toHaveBeenCalled();
});
