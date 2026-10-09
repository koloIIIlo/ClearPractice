import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { toLocalDate } from "@/lib/phrase-schedule";
import { ProgressPage } from "./ProgressPage";

it("saves a real-conversation reflection with the listener's words apart from your own reading (4.17)", async () => {
  const user = userEvent.setup();
  const base = createMockClient();
  const client: IpcClient = { ...base, addTransferReview: vi.fn(base.addTransferReview), deleteTransferReview: vi.fn(base.deleteTransferReview) };
  render(
    <MemoryRouter initialEntries={["/progress?view=real"]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IpcContext.Provider value={client}>
          <ProgressPage />
        </IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByText("No reflections yet")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save reflection" })).toBeDisabled();
  await user.type(screen.getByLabelText("Situation"), "Explained a decision to a colleague");
  await user.selectOptions(screen.getByLabelText("Day"), "Yesterday");
  await user.type(screen.getByLabelText(/their words/), "You want to wait for the tests.");
  await user.type(screen.getByLabelText("Your own reading of how it went"), "The reason came late.");
  await user.click(screen.getByRole("button", { name: "Save reflection" }));
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  expect(client.addTransferReview).toHaveBeenCalledWith(expect.objectContaining({
    localDate: toLocalDate(yesterday), situation: "Explained a decision to a colleague", listenerText: "You want to wait for the tests.", selfReport: "The reason came late.",
  }));
  const saved = (await screen.findByText("Explained a decision to a colleague", { selector: "p" })).closest("li")!;
  expect(within(saved).getByText("Listener feedback, entered by you")).toBeInTheDocument();
  expect(within(saved).getByText("“You want to wait for the tests.”")).toBeInTheDocument();
  expect(within(saved).getByText("Your reading").nextSibling).toHaveTextContent("The reason came late.");
  expect(screen.getByLabelText("Situation")).toHaveValue("");

  await user.click(within(saved).getByRole("button", { name: /Remove the reflection/ }));
  await user.click(within(saved).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(screen.getByText("No reflections yet")).toBeInTheDocument());
}, 15_000);
