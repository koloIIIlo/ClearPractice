import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { PhrasesPage } from "./PhrasesPage";

function setup() {
  const base = createMockClient();
  const client: IpcClient = {
    ...base,
    addPhrase: vi.fn(base.addPhrase),
    updatePhrase: vi.fn(base.updatePhrase),
    deletePhrase: vi.fn(base.deletePhrase),
  };
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IpcContext.Provider value={client}>
          <PhrasesPage />
        </IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}

it("adds a phrase that is new and due today, edits its text and removes it after a confirmation (4.15)", async () => {
  const user = userEvent.setup();
  const client = setup();
  await user.click(await screen.findByRole("button", { name: "Add a phrase" }));
  expect(screen.getByRole("button", { name: "Add phrase" })).toBeDisabled();
  await user.type(screen.getByLabelText("What you said"), "I start with the end");
  await user.type(screen.getByLabelText("A better way to say it"), "I lead with the conclusion");
  await user.type(screen.getByLabelText("Examples (optional, one per line)"), "I lead with the conclusion in reviews.{enter}{enter}");
  await user.click(screen.getByRole("button", { name: "Add phrase" }));
  expect(client.addPhrase).toHaveBeenCalledWith({ original: "I start with the end", expression: "I lead with the conclusion", explanation: "", examples: ["I lead with the conclusion in reviews.", "", ""] });
  const row = (await screen.findByText("I lead with the conclusion")).closest("li")!;
  expect(within(row).getByText("New")).toBeInTheDocument();
  expect(within(row).getByText("Due now")).toBeInTheDocument();

  await user.click(within(row).getByRole("button", { name: "Edit I lead with the conclusion" }));
  const box = screen.getByLabelText("A better way to say it");
  await user.clear(box);
  await user.type(box, "I put the conclusion first");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(client.updatePhrase).toHaveBeenCalledWith(expect.stringMatching(/^ph-/), expect.objectContaining({ expression: "I put the conclusion first" }));
  const edited = (await screen.findByText("I put the conclusion first")).closest("li")!;

  await user.click(within(edited).getByRole("button", { name: "Remove I put the conclusion first" }));
  expect(within(edited).getByText(/Its review history is kept/)).toBeInTheDocument();
  expect(client.deletePhrase).not.toHaveBeenCalled();
  await user.click(within(edited).getByRole("button", { name: "Remove" }));
  expect(client.deletePhrase).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByText("I put the conclusion first")).not.toBeInTheDocument());
});
