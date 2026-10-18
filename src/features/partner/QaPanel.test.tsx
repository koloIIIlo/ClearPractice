import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PANEL } from "@/content/scenarios";
import type { IpcClient } from "@/lib/ipc";
import { renderWithApp } from "@/test/render";
import { TakePartnerActions } from "./TakePartnerActions";
import { partnerClient } from "./test-utils";

async function sampleTake(client: IpcClient) {
  const sessions = await client.listSessions();
  const session = await client.getSession(sessions.find((s) => s.attemptCount > 0)!.id);
  return session.attempts[0].id;
}

it("previews the transcript and starts a three-question conversation after Send", async () => {
  const user = userEvent.setup();
  const client = await partnerClient();
  const take = await sampleTake(client);
  const start = vi.spyOn(client, "startQaPanel");
  renderWithApp(<TakePartnerActions attemptId={take} />, { client, routes: [{ path: "/partner/:id", element: <p>Conversation page</p> }] });
  await user.click(screen.getByRole("button", { name: "Questions from a panel" }));
  const panel = screen.getByRole("group", { name: "Questions from a panel" });
  for (const name of [/^Newcomer/, /^Sceptic/, /^Expert/]) expect(within(panel).getByRole("checkbox", { name })).toBeChecked();
  await user.click(within(panel).getByRole("button", { name: "Preview questions from your answer" }));
  const preview = await within(panel).findByRole("group", { name: "Panel questions preview" });
  expect(preview).toHaveTextContent("Listeners, in this order: newcomer, skeptic, expert");
  expect(preview).toHaveTextContent(/checking my phone/);
  expect(start).not.toHaveBeenCalled();
  await user.click(within(preview).getByRole("button", { name: "Send · may be billed" }));
  expect(await screen.findByText("Conversation page", undefined, { timeout: 3_000 })).toBeInTheDocument();
  expect(start).toHaveBeenCalledWith(take, ["newcomer", "skeptic", "expert"], expect.any(String), expect.any(String));
  const [summary] = await client.listConversations();
  const view = await client.getConversation(summary.id);
  expect(view.conversation).toMatchObject({ scenarioId: "qa-panel", sourceAttemptId: take });
  expect(view.conversation.scenario.maxTurns).toBe(3);
  expect(view.turns.map((t) => t.text)).toEqual([PANEL.newcomer.questions[0]]);
  expect(view.conversation.scenario.hints).toHaveLength(3);
});

it("asks general questions offline, for the listeners you chose", async () => {
  const user = userEvent.setup();
  const client = await partnerClient({ coachingMode: "off" });
  const take = await sampleTake(client);
  const start = vi.spyOn(client, "startConversation");
  renderWithApp(<TakePartnerActions attemptId={take} />, { client, routes: [{ path: "/partner/:id", element: <p>Conversation page</p> }] });
  await user.click(screen.getByRole("button", { name: "Questions from a panel" }));
  const panel = screen.getByRole("group", { name: "Questions from a panel" });
  // With AI off there is no preview, and no upgrade.
  expect(within(panel).queryByRole("button", { name: "Preview questions from your answer" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Upgrade this answer" })).toBeNull();
  await user.click(within(panel).getByRole("checkbox", { name: /^Newcomer/ }));
  await user.click(within(panel).getByRole("button", { name: "Scripted questions (offline)" }));
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(start.mock.calls[0][0]).toMatchObject({ scenarioId: "qa-panel", mode: "scripted", sourceAttemptId: take });
  expect(start.mock.calls[0][0].scenario.maxTurns).toBe(2);
  expect(start.mock.calls[0][0].scenario.opening).toMatch(new RegExp(PANEL.skeptic.questions.map((q) => q.replace(/[?.]/g, "\\$&")).join("|")));
  expect(await screen.findByText("Conversation page")).toBeInTheDocument();
});
