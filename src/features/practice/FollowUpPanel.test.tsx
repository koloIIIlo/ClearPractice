import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { PROMPTS } from "@/content/prompts";
import { FOLLOW_UPS } from "@/content/followups";
import { FollowUpPanel } from "./FollowUpPanel";

const decision = PROMPTS.find((p) => p.id === "p-decision")!;

function setup(overrides: Partial<IpcClient>, props: Partial<Parameters<typeof FollowUpPanel>[0]> = {}) {
  const client: IpcClient = { ...createMockClient(), ...overrides };
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IpcContext.Provider value={client}>
          <FollowUpPanel prompt={decision} sessionId="s1" lastTakeId="t1" takeCount={1} native={false} locked={false} {...props} />
        </IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}

it("every follow-up prompt has written questions, and each shows after the first take as a simulation (5.11)", async () => {
  for (const p of PROMPTS.filter((x) => x.conditions.followUp)) expect(FOLLOW_UPS[p.id]?.length, p.id).toBeGreaterThanOrEqual(2);
  const user = userEvent.setup();
  setup({});
  expect(screen.getByText("Simulation")).toBeInTheDocument();
  expect(screen.getByText(`“${FOLLOW_UPS["p-decision"][0]}”`)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Another question" }));
  expect(screen.getByText(`“${FOLLOW_UPS["p-decision"][1]}”`)).toBeInTheDocument();
  // The browser preview never offers an AI request.
  expect(screen.queryByRole("button", { name: /Ask AI/ })).not.toBeInTheDocument();
});

it("asks the AI only after a preview and Send, and labels the answer", async () => {
  const user = userEvent.setup();
  const client = setup({
    getAttemptTranscript: async () => ({ attemptId: "t1", correction: null, job: null, revision: { id: "t1--1" } as never }),
    previewFollowUp: vi.fn(async () => ({
      version: 1 as const, requestId: "follow-up-1", payloadSha256: "b".repeat(64), recipient: "https://api.openai.com/v1/responses" as const, model: "gpt-6-luna",
      selectedText: "Task: Explain a recent decision\n\nThe learner's answer:\nWe moved the release.", prompt: "p", focus: "f", instructions: "You play a listener",
      maximumOutputTokens: 1024, estimatedMaximumCostMicroUsd: 3000, priceDate: "2026-10-08", priceSource: "https://developers.openai.com/x",
      inputUsdPerMillionTokens: "0.10", outputUsdPerMillionTokens: "0.50", costExplanation: "c", expiresAtMs: 1,
    })),
    requestFollowUp: vi.fn(async () => ({ question: "Who disagreed with the move?", why: "Handling an objection.", model: "gpt-6-luna", estimatedCostMicroUsd: 120 })),
  }, { native: true });
  await user.click(await screen.findByRole("button", { name: "Ask AI for a question…" }));
  expect(client.previewFollowUp).toHaveBeenCalledWith("t1", "gpt-6-luna");
  expect(await screen.findByText(/We moved the release/)).toBeInTheDocument();
  expect(client.requestFollowUp).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Send · may be billed" }));
  expect(await screen.findByText("“Who disagreed with the move?”")).toBeInTheDocument();
  expect(screen.getByText("AI suggestion")).toBeInTheDocument();
});

it("stays hidden for prompts without a follow-up or before the first take", () => {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <IpcContext.Provider value={createMockClient()}>
        <FollowUpPanel prompt={PROMPTS.find((p) => !p.conditions.followUp)!} sessionId="s" lastTakeId="t" takeCount={1} native={false} locked={false} />
      </IpcContext.Provider>
    </QueryClientProvider>,
  );
  expect(container).toBeEmptyDOMElement();
});
