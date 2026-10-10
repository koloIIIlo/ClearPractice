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

it("keeps one focus in view in the recorder, stores it once a take exists, and says when three takes are enough (4.6)", async () => {
  const user = userEvent.setup();
  const client = { ...createMockClient(), setSessionFocus: vi.fn(async () => {}) };
  const view = wrap(client, <RepeatFocus sessionId="s-1" takeCount={0} locked={false} native />);
  expect(screen.getByText("Choose one thing to change")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next focus" }));
  expect(screen.getByText("State the main point in the first sentence")).toBeInTheDocument();
  expect(client.setSessionFocus).not.toHaveBeenCalled(); // no session before the first take
  const at = (takeCount: number) => view.rerender(
    <MemoryRouter><QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}>
      <RepeatFocus sessionId="s-1" takeCount={takeCount} locked={false} native />
    </IpcContext.Provider></QueryClientProvider></MemoryRouter>,
  );
  at(1);
  await waitFor(() => expect(client.setSessionFocus).toHaveBeenCalledWith("s-1", "State the main point in the first sentence"));
  expect(screen.getByText("For take 2: listen back, then change just this one thing.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Previous focus" }));
  await waitFor(() => expect(client.setSessionFocus).toHaveBeenLastCalledWith("s-1", "Slow down a little"));
  await user.click(screen.getByRole("button", { name: "Write your own focus" }));
  await user.type(screen.getByLabelText("Your own focus"), "Name the trade-off");
  await user.click(screen.getByRole("button", { name: "Use" }));
  await waitFor(() => expect(client.setSessionFocus).toHaveBeenLastCalledWith("s-1", "Name the trade-off"));
  at(3);
  expect(screen.getByText(/Three takes is usually enough/)).toBeInTheDocument();
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

it("picks today's focus by itself and says so (§7 smart defaults)", async () => {
  const client = { ...createMockClient(), setSessionFocus: vi.fn(async () => {}) };
  const qc = new QueryClient();
  qc.setQueryData(["today", "standard"], { focus: "Give one concrete example." });
  const ui = (takeCount: number) => (
    <MemoryRouter><QueryClientProvider client={qc}><IpcContext.Provider value={client}>
      <RepeatFocus sessionId="s-3" takeCount={takeCount} locked={false} native />
    </IpcContext.Provider></QueryClientProvider></MemoryRouter>
  );
  const view = render(ui(0));
  expect(screen.getByRole("group", { name: "Today's focus" })).toHaveTextContent("Give one concrete example");
  view.rerender(ui(1));
  await waitFor(() => expect(client.setSessionFocus).toHaveBeenCalledWith("s-3", "Give one concrete example"));
});
