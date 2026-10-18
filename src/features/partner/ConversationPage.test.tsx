import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { expectNoScores } from "@/test/no-scores";
import { conversationInput, partnerClient, renderConversation } from "./test-utils";

const LONG = { timeout: 4_000 };

it("shows captions, your transcript and the cost so far", async () => {
  const user = userEvent.setup();
  const client = await partnerClient();
  const view = await client.startConversation(conversationInput("api", { pressure: 2 }));
  renderConversation(client, view.conversation.id);
  expect(await screen.findByRole("heading", { level: 1, name: "Job interview" })).toBeInTheDocument();
  expect(screen.getByText(/OpenAI · Interviewer · Pressure 2 \(Pressure\) · 1 of 8 turns/)).toBeInTheDocument();
  // No offline voice in tests: the partner speaks in captions.
  expect(screen.getByText(/No offline English voice found on this computer/)).toBeInTheDocument();
  const conversation = screen.getByRole("list", { name: "Conversation" });
  expect(within(conversation).getByText("“Thanks for coming in. To start, could you walk me through your background?”")).toBeInTheDocument();

  await user.type(screen.getByRole("textbox", { name: "Your answer" }), "I studied computer science and built payment systems.");
  await user.click(screen.getByRole("button", { name: "Answer" }));
  expect(await within(conversation).findByText("“I studied computer science and built payment systems.”")).toBeInTheDocument();
  expect(within(conversation).getByText("You (typed)")).toBeInTheDocument();
  const bar = await screen.findByRole("region", { name: "Send bar" }, LONG);
  expect(bar).toHaveTextContent(/Send your answer to OpenAI · gpt-6-luna · at most \$0\.\d{4} · this conversation \$0\.00 of \$0\.05/);
  await user.click(within(bar).getByText("Exactly what is sent"));
  expect(within(bar).getByText(/Learner: I studied computer science and built payment systems\./)).toBeVisible();
  await user.click(within(bar).getByRole("button", { name: "Send" }));
  expect(await within(conversation).findByText("“What made you interested in this role?”", undefined, LONG)).toBeInTheDocument();
  expect(screen.getByText(/2 of 8 turns/)).toBeInTheDocument();
  // The next preview shows what the conversation has spent.
  await user.type(screen.getByRole("textbox", { name: "Your answer" }), "The team and the product.");
  await user.click(screen.getByRole("button", { name: "Answer" }));
  expect(await screen.findByRole("region", { name: "Send bar" }, LONG)).toHaveTextContent(/this conversation \$0\.0\d{3} of \$0\.05/);
  expectNoScores();
});

it("typed answers work without transcription", async () => {
  const user = userEvent.setup();
  const client = await partnerClient();
  const view = await client.startConversation(conversationInput("scripted"));
  const add = vi.spyOn(client, "addLearnerTurn");
  renderConversation(client, view.conversation.id, "?typed=1");
  // Without local Whisper there is no recorder, only the text field.
  expect(screen.queryByRole("button", { name: /Record your answer/ })).toBeNull();
  await user.type(await screen.findByRole("textbox", { name: "Your answer" }), "I led a migration{Control>}{Enter}{/Control}");
  await waitFor(() => expect(add).toHaveBeenCalledWith(view.conversation.id, { typedText: "I led a migration" }));
  expect(await screen.findByText("“What made you interested in this role?”", undefined, LONG)).toBeInTheDocument();
  expect(screen.getByText(/Typed answers count as practice; they have no audio measures\./)).toBeInTheDocument();
});

it("asks scripted lines in order and ends after maxTurns", async () => {
  const user = userEvent.setup();
  const client = await partnerClient();
  const input = conversationInput("scripted");
  const view = await client.startConversation({ ...input, scenario: { ...input.scenario, maxTurns: 3 } });
  renderConversation(client, view.conversation.id);
  const conversation = await screen.findByRole("list", { name: "Conversation" });
  for (const text of ["First answer.", "Second answer.", "Third answer."]) {
    await user.type(await screen.findByRole("textbox", { name: "Your answer" }, LONG), text);
    await user.click(screen.getByRole("button", { name: "Answer" }));
    await within(conversation).findByText(`“${text}”`);
  }
  const summary = await screen.findByRole("region", { name: "Summary" }, LONG);
  expect(summary).toHaveTextContent("3 turns");
  // The opening, then the scenario's scripted lines in order (the general follow-up is mixed in second).
  const partnerLines = (await client.getConversation(view.conversation.id)).turns.filter((t) => t.role === "partner").map((t) => t.text);
  expect(partnerLines).toEqual([input.scenario.opening, input.scenario.script[0].text, input.scenario.script[1].text]);
  expect(screen.queryByRole("button", { name: "End conversation" })).toBeNull();
  expect((await client.getConversation(view.conversation.id)).conversation.status).toBe("ended");
});
