import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { PhraseSuggestions } from "./PhraseSuggestions";

it("previews exactly what would be sent, sends only on Send, and keeps the suggestions you tick", async () => {
  const user = userEvent.setup();
  const base = createMockClient();
  const client: IpcClient = {
    ...base,
    previewPhraseSuggestions: vi.fn(base.previewPhraseSuggestions),
    requestPhraseSuggestions: vi.fn(base.requestPhraseSuggestions),
    addPhrase: vi.fn(base.addPhrase),
  };
  const onDone = vi.fn();
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IpcContext.Provider value={client}>
          <PhraseSuggestions onDone={onDone} />
        </IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  // The latest day's transcribed sessions are ticked to start with.
  expect(await screen.findByRole("checkbox", { name: /A habit I want to change/ })).toBeChecked();
  await user.click(screen.getByRole("button", { name: /Preview the request/ }));
  const preview = await screen.findByRole("group", { name: "Request preview" });
  expect(preview).toHaveTextContent("never audio");
  expect(client.requestPhraseSuggestions).not.toHaveBeenCalled();

  await user.click(within(preview).getByRole("button", { name: /Send/ }));
  // "I lost track of time" is already one of your phrases, so it starts unticked.
  const known = await screen.findByRole("checkbox", { name: /I lost track of time/ });
  expect(known).not.toBeChecked();
  expect(screen.getByText("Already in your phrases")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /the moment I wake up/ })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Add 1 phrase" }));
  await waitFor(() => expect(client.addPhrase).toHaveBeenCalledTimes(1));
  expect(client.addPhrase).toHaveBeenCalledWith(
    expect.objectContaining({ original: "first thing in the morning", expression: "the moment I wake up", examples: ["I check the weather the moment I wake up."] }),
    expect.any(String),
  );
  await waitFor(() => expect(onDone).toHaveBeenCalled());
});
