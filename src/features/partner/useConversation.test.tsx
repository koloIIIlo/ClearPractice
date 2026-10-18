import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PARTNER_DELAY_MS } from "@/lib/ipc/mock-partner";
import { conversationInput, partnerClient, renderConversation } from "./test-utils";

const LONG = { timeout: 4_000 };

async function answer(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(await screen.findByRole("textbox", { name: "Your answer" }), text);
  await user.click(screen.getByRole("button", { name: "Answer" }));
}

/**
 * The turn loop (roadmap 13.4) with typed answers: in tests, as in the
 * browser preview, local transcription isn't available.
 */
describe("the turn loop", () => {
  it("never sends in API mode without Send", async () => {
    const user = userEvent.setup();
    const client = await partnerClient();
    const view = await client.startConversation(conversationInput("api"));
    const preview = vi.spyOn(client, "previewPartnerTurn");
    const request = vi.spyOn(client, "requestPartnerTurn");
    renderConversation(client, view.conversation.id);
    await answer(user, "I led a database migration last year.");
    expect(await screen.findByRole("region", { name: "Send bar" }, LONG)).toBeInTheDocument();
    expect(preview).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, PARTNER_DELAY_MS + 200));
    expect(request).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/What made you interested in this role\?/, undefined, LONG)).toBeInTheDocument();
  });

  it("auto-sends only in local mode with the box ticked", async () => {
    const user = userEvent.setup();
    const client = await partnerClient({ coachingMode: "local" });
    const auto = vi.spyOn(client, "sendPartnerTurnAuto");
    const preview = vi.spyOn(client, "previewPartnerTurn");
    const ticked = await client.startConversation(conversationInput("local", { autoSendLocal: true }));
    const { unmount } = renderConversation(client, ticked.conversation.id);
    await answer(user, "I led a migration.");
    await waitFor(() => expect(auto).toHaveBeenCalledTimes(1));
    expect(preview).not.toHaveBeenCalled();
    expect(await screen.findByText(/What made you interested in this role\?/, undefined, LONG)).toBeInTheDocument();
    unmount();

    const unticked = await client.startConversation(conversationInput("local", { autoSendLocal: false }));
    renderConversation(client, unticked.conversation.id);
    await answer(user, "I led a migration.");
    expect(await screen.findByText("Send to the local model on this computer · free", undefined, LONG)).toBeInTheDocument();
    expect(preview).toHaveBeenCalledTimes(1);
    expect(auto).toHaveBeenCalledTimes(1);
  });

  it("scripted mode makes no requests", async () => {
    const user = userEvent.setup();
    const client = await partnerClient();
    const view = await client.startConversation(conversationInput("scripted"));
    const calls = [vi.spyOn(client, "previewPartnerTurn"), vi.spyOn(client, "requestPartnerTurn"), vi.spyOn(client, "sendPartnerTurnAuto")];
    const scripted = vi.spyOn(client, "nextScriptedTurn");
    renderConversation(client, view.conversation.id);
    expect(await screen.findByText(/Scripted \(offline\): the partner asks prepared questions/)).toBeInTheDocument();
    await answer(user, "I studied computer science and then built payment systems.");
    expect(await screen.findByText(/What made you interested in this role\?/, undefined, LONG)).toBeInTheDocument();
    expect(scripted).toHaveBeenCalledTimes(1);
    for (const call of calls) expect(call).not.toHaveBeenCalled();
  });

  it("reopening an active conversation makes no request", async () => {
    const user = userEvent.setup();
    const client = await partnerClient({ coachingMode: "local" });
    const local = await client.startConversation(conversationInput("local", { autoSendLocal: true }));
    await client.addLearnerTurn(local.conversation.id, { typedText: "An answer from before." });
    const api = await client.startConversation(conversationInput("api"));
    await client.addLearnerTurn(api.conversation.id, { typedText: "Another answer from before." });
    const auto = vi.spyOn(client, "sendPartnerTurnAuto");
    const request = vi.spyOn(client, "requestPartnerTurn");
    // A local conversation with auto-send waits for Send when reopened.
    const { unmount } = renderConversation(client, local.conversation.id);
    expect(await screen.findByText("Send to the local model on this computer · free", undefined, LONG)).toBeInTheDocument();
    expect(screen.getByText("“An answer from before.”")).toBeInTheDocument();
    unmount();
    renderConversation(client, api.conversation.id);
    expect(await screen.findByRole("region", { name: "Send bar" }, LONG)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, PARTNER_DELAY_MS + 200));
    expect(auto).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    // Ending is yours too.
    await user.click(screen.getByRole("button", { name: "End conversation" }));
    expect(await screen.findByRole("region", { name: "Summary" })).toBeInTheDocument();
  });

  it("refuses a preview over the conversation's cost limit and offers to raise it", async () => {
    const user = userEvent.setup();
    const client = await partnerClient();
    const view = await client.startConversation(conversationInput("api", { maxCostMicroUsd: 10_000 }));
    const id = view.conversation.id;
    // Spend most of the limit first: each turn counts what it cost.
    for (let i = 0; i < 8; i++) {
      await client.addLearnerTurn(id, { typedText: `Answer ${i + 1}.` });
      const p = await client.previewPartnerTurn(id).catch(() => null);
      if (!p) break;
      await client.requestPartnerTurn(id, p.requestId, p.payloadSha256);
    }
    const raise = vi.spyOn(client, "setConversationLimit");
    renderConversation(client, id);
    expect(await screen.findByRole("alert", undefined, LONG)).toHaveTextContent("This conversation reached its cost limit ($0.01). End it, or raise its limit.");
    expect(screen.queryByRole("region", { name: "Send bar" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Raise the limit to $0.02" }));
    await waitFor(() => expect(raise).toHaveBeenCalledWith(id, 20_000));
    expect(await screen.findByRole("region", { name: "Send bar" }, LONG)).toHaveTextContent(/this conversation \$0\.\d{4} of \$0\.02/);
  }, 20_000);
});
