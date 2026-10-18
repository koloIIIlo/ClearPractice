import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { renderWithApp } from "@/test/render";
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
  renderWithApp(<PhraseSuggestions onDone={onDone} />, { client });
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

it("offers local suggestions without cost when coaching is local", async () => {
  const user = userEvent.setup();
  const base = createMockClient();
  await base.setPreferences({ ...await base.getPreferences(), coachingMode: "local", localModel: "my-local-model" });
  const client: IpcClient = {
    ...base,
    previewPhraseSuggestionsLocal: vi.fn(base.previewPhraseSuggestionsLocal),
    sendPhraseSuggestionsLocal: vi.fn(base.sendPhraseSuggestionsLocal),
    previewPhraseSuggestions: vi.fn(base.previewPhraseSuggestions),
    requestPhraseSuggestions: vi.fn(base.requestPhraseSuggestions),
  };
  renderWithApp(<PhraseSuggestions onDone={vi.fn()} />, { client });
  await screen.findByRole("checkbox", { name: /A habit I want to change/ });
  await user.click(screen.getByRole("button", { name: "Preview the request" }));
  const preview = await screen.findByRole("group", { name: "Request preview" });
  expect(preview).toHaveTextContent("Recipient: local model on this computer · free");
  expect(preview).not.toHaveTextContent("$");
  expect(screen.queryByText(/Choose in Settings/)).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Model" })).not.toBeInTheDocument();
  expect(client.sendPhraseSuggestionsLocal).not.toHaveBeenCalled();
  expect(client.previewPhraseSuggestions).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Send to the local model" }));
  expect(await screen.findByRole("checkbox", { name: /the moment I wake up/ })).toBeChecked();
  expect(client.sendPhraseSuggestionsLocal).toHaveBeenCalledOnce();
  expect(client.requestPhraseSuggestions).not.toHaveBeenCalled();
});

it("shows the Coaching settings note only when coaching is off", async () => {
  const base = createMockClient();
  await base.setPreferences({ ...await base.getPreferences(), coachingMode: "off" });
  renderWithApp(<PhraseSuggestions onDone={vi.fn()} />, { client: base });
  expect(await screen.findByRole("link", { name: "Choose in Settings → Coaching" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Preview the request" })).not.toBeInTheDocument();
});
