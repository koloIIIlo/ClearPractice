import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import type { ConversationTurn, ConversationView } from "@/lib/ipc/schemas";
import { expectNoScores } from "@/test/no-scores";
import { renderWithApp } from "@/test/render";
import { ConversationSummary } from "./ConversationSummary";
import { conversationInput, partnerClient } from "./test-utils";

it("lists turns with takes and offers feedback, upgrade and phrases", async () => {
  const user = userEvent.setup();
  const client = await partnerClient();
  const started = await client.startConversation(conversationInput("api", { pressure: 2 }));
  const id = started.conversation.id;
  await client.addLearnerTurn(id, { typedText: "A typed answer." });
  const ended = await client.endConversation(id);
  const [opening, typed] = ended.turns;
  const interrupt: ConversationTurn = { ...opening, id: "turn-i", ordinal: 3, move: "interrupt", text: "Sorry, can I stop you there? What was the result?" };
  const spoken: ConversationTurn = { ...typed, id: "turn-s", ordinal: 4, typed: false, text: "We shipped a week early.", attemptId: "take-1", revisionId: "rev-1", takeAvailable: true, durationMs: 84_000, outOfTime: true };
  const view: ConversationView = { ...ended, turns: [opening, typed, interrupt, spoken], learnerTurns: 2 };
  renderWithApp(<ConversationSummary view={view} />, { client });

  const summary = screen.getByRole("region", { name: "Summary" });
  expect(summary).toHaveTextContent("Job interview · Interviewer · Pressure 2 (Pressure)");
  expect(summary).toHaveTextContent("2 turns · your speaking time 1:24 · longest answer 1:24 · 1 interruption handled");
  await user.click(screen.getByText("Your answers"));
  expect(screen.getByText("“A typed answer.”")).toBeVisible();
  expect(screen.getByText("“We shipped a week early.”")).toBeVisible();
  expect(screen.getByRole("link", { name: "Save phrases" })).toHaveAttribute("href", `/phrases?suggest=${view.conversation.sessionId}`);
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  // Upgrade one answer: the longest spoken one is chosen; "weakest" is never said.
  expect(screen.getByRole("combobox", { name: "Answer" })).toHaveTextContent("Answer 2 (1:24)");
  expect(screen.getByRole("button", { name: "Upgrade this answer" })).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/weakest/i);

  // AI feedback: previewed, then sent on Send, and labelled an AI suggestion.
  await user.click(screen.getByRole("button", { name: "AI feedback on this conversation" }));
  const preview = await screen.findByRole("group", { name: "Conversation feedback preview" });
  expect(preview).toHaveTextContent("Learner: A typed answer.");
  expect(preview).toHaveTextContent("Partner: Thanks for coming in.");
  await user.click(within(preview).getByRole("button", { name: "Send · may be billed" }));
  expect(await screen.findByText("You answered every question and kept the conversation moving.", undefined, { timeout: 3_000 })).toBeInTheDocument();
  expect((await client.getConversation(id)).feedback).toHaveLength(1);
  expectNoScores();
});

it("a scripted conversation says it didn't adapt, and a panel can't be tried again", async () => {
  const client = await partnerClient();
  const view = await client.startConversation(conversationInput("scripted"));
  const ended = await client.endConversation(view.conversation.id);
  const { unmount } = renderWithApp(<ConversationSummary view={ended} />, { client });
  expect(screen.getByText("The scripted partner asked prepared questions and didn't adapt to your answers.")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Summary" })).toHaveTextContent("0 turns");
  unmount();
  const panel: ConversationView = { ...ended, conversation: { ...ended.conversation, scenarioId: "qa-panel" } };
  renderWithApp(<ConversationSummary view={panel} />, { client });
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});
