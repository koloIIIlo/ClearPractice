import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { PROMPTS } from "@/content/prompts";
import { ExercisesPage } from "./ExercisesPage";

function setup() {
  const base = createMockClient();
  const client: IpcClient = { ...base, addPrompt: vi.fn(base.addPrompt), updatePrompt: vi.fn(base.updatePrompt), deletePrompt: vi.fn(base.deletePrompt) };
  render(
    <MemoryRouter initialEntries={["/exercises?tab=prompts"]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IpcContext.Provider value={client}>
          <ExercisesPage />
        </IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}

const rows = () => screen.getAllByRole("listitem").filter((li) => within(li).queryByRole("link", { name: "Practise" }));

it("filters prompts by preparation and demands (4.13)", async () => {
  const user = userEvent.setup();
  setup();
  await screen.findAllByRole("link", { name: "Practise" });
  expect(rows()).toHaveLength(PROMPTS.length);
  await user.click(screen.getByRole("radio", { name: "No preparation" }));
  expect(rows()).toHaveLength(PROMPTS.filter((p) => p.conditions.preparationSeconds === 0).length);
  await user.click(screen.getByRole("radio", { name: "No preparation" }));
  await user.click(screen.getByRole("button", { name: "Follow-up question" }));
  await user.click(screen.getByRole("button", { name: "Named audience" }));
  expect(rows()).toHaveLength(PROMPTS.filter((p) => p.conditions.followUp && p.conditions.audience).length);
  await user.click(screen.getByRole("button", { name: "Your prompts" }));
  expect(screen.getByText("No prompts match these filters")).toBeInTheDocument();
});

it("adds, edits and removes your own prompt; bundled prompts stay unchanged", async () => {
  const user = userEvent.setup();
  const client = setup();
  await user.click(await screen.findByRole("button", { name: "Add your own prompt" }));
  expect(screen.getByRole("button", { name: "Add prompt" })).toBeDisabled();
  await user.type(screen.getByLabelText("Prompt"), "Explain our release process to a new colleague.");
  await user.click(screen.getAllByRole("button", { name: "Work" }).at(-1)!); // the form comes after the filters
  await user.type(screen.getByLabelText("Audience (optional)"), "A new colleague");
  await user.click(screen.getByRole("switch", { name: "Answer a follow-up question" }));
  expect(screen.getByText(/Demands: 90 s · unfamiliar topic · 30 s to prepare · for a new colleague · one follow-up/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add prompt" }));
  expect(client.addPrompt).toHaveBeenCalledWith({
    text: "Explain our release process to a new colleague.", tags: ["work"],
    conditions: { familiarity: "unfamiliar", preparationSeconds: 30, targetSeconds: 90, audience: "A new colleague", followUp: true },
  });
  const row = (await screen.findByText("Explain our release process to a new colleague.", { selector: "p" })).closest("li")!;
  expect(within(row).getByText(/Your prompt/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Your prompts" }));
  expect(rows()).toHaveLength(1);

  await user.click(within(row).getByRole("button", { name: /^Edit / }));
  const box = screen.getByLabelText("Prompt");
  await user.clear(box);
  await user.type(box, "Explain the release process in one minute.");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(client.updatePrompt).toHaveBeenCalled();
  const edited = (await screen.findByText("Explain the release process in one minute.", { selector: "p" })).closest("li")!;
  await user.click(within(edited).getByRole("button", { name: /^Remove / }));
  expect(within(edited).getByText(/Sessions that used it keep their text/)).toBeInTheDocument();
  await user.click(within(edited).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(screen.queryByText("Explain the release process in one minute.")).not.toBeInTheDocument());
  // Bundled prompts have no edit or remove buttons.
  await user.click(screen.getByRole("button", { name: "Your prompts" }));
  expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
  expect(PROMPTS.some((p) => p.source === "user")).toBe(false);
}, 20_000);
