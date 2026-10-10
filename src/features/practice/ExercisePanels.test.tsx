import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { phrases, sessions } from "@/lib/ipc/mock-data";
import { ExpressionPanel, expressionPrompt, ImitationPanel, RepeatFocus } from "./ExercisePanels";

function wrap(client: IpcClient, ui: React.ReactNode) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <IpcContext.Provider value={client}>{ui}</IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

it("asks for one focus after the first take, stores it, and says when three takes are enough (4.6)", async () => {
  const user = userEvent.setup();
  const client = { ...createMockClient(), setSessionFocus: vi.fn(async () => {}) };
  const view = wrap(client, <RepeatFocus sessionId="s-1" takeCount={0} locked={false} native />);
  expect(view.container).toBeEmptyDOMElement();
  view.rerender(
    <MemoryRouter><QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}>
      <RepeatFocus sessionId="s-1" takeCount={1} locked={false} native />
    </IpcContext.Provider></QueryClientProvider></MemoryRouter>,
  );
  expect(screen.getByRole("heading", { name: "Before take 2: choose one thing to improve" })).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "Give one concrete example" }));
  expect(client.setSessionFocus).toHaveBeenCalledWith("s-1", "Give one concrete example");
  expect(await screen.findByText("Focus for the next take: Give one concrete example.")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Your own focus"), "Name the trade-off");
  await user.click(screen.getByRole("button", { name: "Use this focus" }));
  expect(client.setSessionFocus).toHaveBeenLastCalledWith("s-1", "Name the trade-off");
  view.rerender(
    <MemoryRouter><QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}>
      <RepeatFocus sessionId="s-1" takeCount={3} locked={false} native />
    </IpcContext.Provider></QueryClientProvider></MemoryRouter>,
  );
  expect(screen.getByRole("heading", { name: "Three takes is usually enough" })).toBeInTheDocument();
});

it("uses a saved expression in three sentences and saves them to the session notes after a take (4.9)", async () => {
  const user = userEvent.setup();
  const session = sessions[0];
  const client = { ...createMockClient(), updateSession: vi.fn(async () => {}) };
  const phrase = phrases[0];
  expect(expressionPrompt(phrase).text).toBe(`Use “${phrase.expression}” in three sentences of your own.`);
  wrap(client, <ExpressionPanel phrase={phrase} phrases={phrases} sessionId={session.id} hasTake locked={false} native onChoose={vi.fn()} />);
  expect(screen.getByRole("heading", { name: `“${phrase.expression}”` })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save to session notes" })).toBeDisabled();
  await user.type(screen.getByLabelText("Sentence 1"), "First sentence.");
  await user.type(screen.getByLabelText("Sentence 3"), "Third sentence.");
  await user.click(screen.getByRole("button", { name: "Save to session notes" }));
  await waitFor(() => expect(client.updateSession).toHaveBeenCalledOnce());
  const [, details] = (client.updateSession as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { notes: string; title: string }];
  expect(details.title).toBe(session.title);
  expect(details.notes).toContain(`Sentences with “${phrase.expression}”:\n1. First sentence.\n2. Third sentence.`);
});

it("keeps typed sentences as the phrase's examples without any recording (4.9)", async () => {
  const user = userEvent.setup();
  const base = createMockClient();
  const client = { ...base, updatePhrase: vi.fn(base.updatePhrase) };
  const phrase = { ...phrases[0], examples: ["Old example."] };
  wrap(client, <ExpressionPanel phrase={phrase} phrases={phrases} sessionId="s-9" hasTake={false} locked={false} native onChoose={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Save to session notes" })).toBeDisabled();
  await user.type(screen.getByLabelText("Sentence 2"), "A new sentence.");
  await user.click(screen.getByRole("button", { name: "Keep as examples of this phrase" }));
  expect(client.updatePhrase).toHaveBeenCalledWith(phrase.id, { original: phrase.original, expression: phrase.expression, explanation: phrase.explanation, examples: ["A new sentence.", "Old example."] });
  expect(await screen.findByText(/Kept with/)).toBeInTheDocument();
});

it("lets the user choose one feature to imitate and stores it after the first take (4.8)", async () => {
  const user = userEvent.setup();
  const client = { ...createMockClient(), setSessionFocus: vi.fn(async () => {}) };
  const view = wrap(client, <ImitationPanel sessionId="s-2" hasTake={false} locked={false} native />);
  expect(screen.getByRole("note")).toHaveTextContent("record your repetition with the clip stopped");
  expect(await screen.findByText(/No clips yet/)).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "Phrase rhythm" }));
  expect(client.setSessionFocus).not.toHaveBeenCalled(); // no session before the first take
  view.rerender(
    <MemoryRouter><QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}>
      <ImitationPanel sessionId="s-2" hasTake locked={false} native />
    </IpcContext.Provider></QueryClientProvider></MemoryRouter>,
  );
  await waitFor(() => expect(client.setSessionFocus).toHaveBeenCalledWith("s-2", "Phrase rhythm"));
});

it("preselects today's focus for the next take and says where it came from (§7 smart defaults)", async () => {
  const client = { ...createMockClient(), setSessionFocus: vi.fn(async () => {}) };
  const qc = new QueryClient();
  qc.setQueryData(["today", "standard"], { focus: "Give one concrete example." });
  render(
    <MemoryRouter><QueryClientProvider client={qc}><IpcContext.Provider value={client}>
      <RepeatFocus sessionId="s-3" takeCount={1} locked={false} native />
    </IpcContext.Provider></QueryClientProvider></MemoryRouter>,
  );
  await waitFor(() => expect(client.setSessionFocus).toHaveBeenCalledWith("s-3", "Give one concrete example"));
  expect(await screen.findByRole("radio", { name: /Give one concrete example/ })).toBeChecked();
  expect(screen.getByText("· Today's focus")).toBeInTheDocument();
  expect(screen.getByText(/Suggested from today's focus/)).toBeInTheDocument();
});
