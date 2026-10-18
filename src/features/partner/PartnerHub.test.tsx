import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import { renderWithApp } from "@/test/render";
import { choose } from "@/test/select";
import { PartnerHubPage as PartnerHub } from "./PartnerHub";
import { partnerClient } from "./test-utils";

async function openStart(user: ReturnType<typeof userEvent.setup>, scenario = "Job interview") {
  await user.click(await screen.findByRole("button", { name: `Start ${scenario}` }));
  return screen.findByRole("dialog", { name: scenario });
}

it("offers scripted mode always and API only with a key and API coaching", async () => {
  const user = userEvent.setup();
  // The preview has no key stored.
  const { unmount } = renderWithApp(<PartnerHub />, { client: createMockClient() });
  expect(screen.getByRole("heading", { level: 1, name: "Partner" })).toBeInTheDocument();
  expect(await screen.findAllByRole("button", { name: /^Start / })).toHaveLength(8);
  let dialog = await openStart(user);
  expect(within(dialog).getByRole("radio", { name: "Scripted (offline)" })).toBeEnabled();
  expect(within(dialog).getByRole("radio", { name: "Scripted (offline)" })).toBeChecked();
  expect(within(dialog).getByRole("radio", { name: "OpenAI, with your key" })).toBeDisabled();
  expect(within(dialog).getByText(/Store your OpenAI key in Settings → Coaching first\./)).toBeInTheDocument();
  expect(within(dialog).getByRole("radio", { name: "Local model" })).toBeDisabled();
  unmount();

  // With a key and Coaching set to OpenAI, OpenAI is offered first.
  renderWithApp(<PartnerHub />, { client: await partnerClient() });
  dialog = await openStart(user);
  await waitFor(() => expect(within(dialog).getByRole("radio", { name: "OpenAI, with your key" })).toBeChecked());
  expect(within(dialog).getByRole("radio", { name: "Scripted (offline)" })).toBeEnabled();
  expect(within(dialog).getByRole("spinbutton", { name: "Cost limit for this conversation (USD)" })).toHaveValue(0.05);
});

it("shows the typed-answers option when local transcription is missing", async () => {
  const user = userEvent.setup();
  renderWithApp(<PartnerHub />, { client: await partnerClient({ coachingMode: "local" }) });
  const dialog = await openStart(user, "Small talk at a meetup");
  expect(within(dialog).getByRole("note")).toHaveTextContent(/Spoken answers are transcribed on this computer first\..*Until then, you type your answers\./);
  expect(within(dialog).getByRole("link", { name: "Transcription settings" })).toHaveAttribute("href", "/settings/transcription");
  // A local model: sending without asking is your choice.
  await waitFor(() => expect(within(dialog).getByRole("radio", { name: "Local model" })).toBeChecked());
  expect(within(dialog).getByRole("checkbox", { name: "Send turns to the local model without asking" })).not.toBeChecked();
});

it("starts a conversation with the chosen persona, pressure and limit", async () => {
  const user = userEvent.setup();
  const client = await partnerClient();
  const start = vi.spyOn(client, "startConversation");
  renderWithApp(<PartnerHub />, { client, routes: [{ path: "/partner/:id", element: <p>Conversation page</p> }] });
  const dialog = await openStart(user);
  await choose(user, within(dialog).getByRole("combobox", { name: "The partner's manner" }), /^Sceptical/);
  await user.click(within(dialog).getByRole("radio", { name: /3 · High stakes/ }));
  const limit = within(dialog).getByRole("spinbutton", { name: "Cost limit for this conversation (USD)" });
  await user.clear(limit);
  await user.type(limit, "0.10");
  await user.click(within(dialog).getByRole("button", { name: "Start" }));
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(start.mock.calls[0][0]).toMatchObject({ scenarioId: "job-interview", personaId: "skeptic", pressure: 3, mode: "api", modelId: "gpt-6-luna", maxCostMicroUsd: 100_000, autoSendLocal: false });
  expect(start.mock.calls[0][0].scenario).toMatchObject({ title: "Job interview", personaTitle: "Sceptical", maxTurns: 8, bossId: null });
  expect(await screen.findByText("Conversation page")).toBeInTheDocument();
  // It is listed with your conversations (the preview also has a sample one).
  expect((await client.listConversations()).map((c) => c.scenarioId)).toEqual(["job-interview", "small-talk"]);
});

it("plays a boss with the partner from its preset", async () => {
  renderWithApp(<PartnerHub />, { client: await partnerClient(), path: "/partner?boss=meeting" });
  const dialog = await screen.findByRole("dialog", { name: "Meeting status update" });
  expect(within(dialog).getByRole("radio", { name: /3 · High stakes/ })).toBeChecked();
  expect(within(dialog).getByRole("combobox", { name: "The partner's manner" })).toHaveTextContent(/^Neutral/);
});
