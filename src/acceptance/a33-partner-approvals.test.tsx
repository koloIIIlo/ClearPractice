import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { conversationInput, partnerClient, renderConversation } from "@/features/partner/test-utils";
import { partnerAutoKey } from "@/lib/ipc/client";
import { PARTNER_DELAY_MS } from "@/lib/ipc/mock-partner";

const LONG = { timeout: 4_000 };

async function answer(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(await screen.findByRole("textbox", { name: "Your answer" }, LONG), text);
  await user.click(screen.getByRole("button", { name: "Answer" }));
}

/**
 * A-33 (roadmap 13.1, D-33): nothing reaches a provider without its own
 * preview and Send. Each approval is single-use and bound to your answers as
 * previewed; a changed answer needs a new preview; Stop waiting adds nothing;
 * only a local model may answer without asking, and only when you ticked it.
 * The native half (binding, single use, loopback only, the cost limit, stop
 * waiting) is in src-tauri/src/acceptance.rs.
 */
describe("A-33 partner approvals", () => {
  it("each OpenAI turn needs its own Send, and an approval is used once", async () => {
    const user = userEvent.setup();
    const client = await partnerClient();
    const view = await client.startConversation(conversationInput("api"));
    const request = vi.spyOn(client, "requestPartnerTurn");
    renderConversation(client, view.conversation.id);
    await answer(user, "First answer.");
    const bar = await screen.findByRole("region", { name: "Send bar" }, LONG);
    await new Promise((r) => setTimeout(r, PARTNER_DELAY_MS + 100));
    expect(request).not.toHaveBeenCalled();
    await user.click(within(bar).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    // The approval is gone once sent: replaying it is refused.
    const [, requestId, hash] = request.mock.calls[0];
    await expect(client.requestPartnerTurn(view.conversation.id, requestId, hash)).rejects.toThrow(/missing|different request/);
    await answer(user, "Second answer.");
    expect(await screen.findByRole("region", { name: "Send bar" }, LONG)).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(2); // the Send and the refused replay above: the new answer waits for its own Send
  });

  it("a changed answer discards the old approval and needs a new preview", async () => {
    const user = userEvent.setup();
    const client = await partnerClient();
    const view = await client.startConversation(conversationInput("api"));
    const preview = vi.spyOn(client, "previewPartnerTurn");
    const cancel = vi.spyOn(client, "cancelCoachingPreview");
    renderConversation(client, view.conversation.id);
    await answer(user, "I led the migration.");
    await screen.findByRole("region", { name: "Send bar" }, LONG);
    const first = (await preview.mock.results[0].value) as { requestId: string; payloadSha256: string };
    // Answer again before sending: the waiting answer is replaced.
    await answer(user, "I led the database migration.");
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(first.requestId));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    await expect(client.requestPartnerTurn(view.conversation.id, first.requestId, first.payloadSha256)).rejects.toThrow();
    expect(await screen.findByText("“I led the database migration.”")).toBeInTheDocument();
    expect(screen.queryByText("“I led the migration.”")).toBeNull();
  });

  it("Stop waiting adds nothing and keeps your answer", async () => {
    const user = userEvent.setup();
    const client = await partnerClient();
    const view = await client.startConversation(conversationInput("api"));
    const stop = vi.spyOn(client, "stopPartnerRequest");
    renderConversation(client, view.conversation.id);
    await answer(user, "My answer.");
    await user.click(within(await screen.findByRole("region", { name: "Send bar" }, LONG)).getByRole("button", { name: "Send" }));
    await user.click(await screen.findByRole("button", { name: "Stop waiting" }));
    expect(stop).toHaveBeenCalledWith(expect.stringMatching(/^partner-/));
    expect(await screen.findByRole("alert", undefined, LONG)).toHaveTextContent(/Stopped waiting/);
    const after = await client.getConversation(view.conversation.id);
    expect(after.turns.map((t) => t.role)).toEqual(["partner", "learner"]);
    expect(screen.getByText("“My answer.”")).toBeInTheDocument();
    // A fresh preview is one click away; nothing is resent by itself.
    await user.click(screen.getByRole("button", { name: "Preview again" }));
    expect(await screen.findByRole("region", { name: "Send bar" }, LONG)).toBeInTheDocument();
  });

  it("only a local model with the box ticked answers without asking, and Stop waiting covers it", async () => {
    const user = userEvent.setup();
    const client = await partnerClient({ coachingMode: "local" });
    const view = await client.startConversation(conversationInput("local", { autoSendLocal: true }));
    const stop = vi.spyOn(client, "stopPartnerRequest");
    renderConversation(client, view.conversation.id);
    await answer(user, "My answer.");
    expect(await screen.findByText("Sending to the local model…")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop waiting" }));
    expect(stop).toHaveBeenCalledWith(partnerAutoKey(view.conversation.id));
    await expect(client.sendPartnerTurnAuto((await client.startConversation(conversationInput("api"))).conversation.id)).rejects.toThrow(/Only a local model/);
  });
});
