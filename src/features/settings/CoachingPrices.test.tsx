import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { toLocalDate } from "@/lib/phrase-schedule";
import { CoachingPrices } from "./CoachingPrices";

it("shows built-in prices and lets you enter a new, dated price or go back to the built-in one (5.9)", async () => {
  const user = userEvent.setup();
  const base = createMockClient();
  const client: IpcClient = { ...base, setPreferences: vi.fn(base.setPreferences) };
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><CoachingPrices /></IpcContext.Provider></QueryClientProvider>);
  expect(await screen.findByText("$0.10 / $0.50")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Edit the GPT-6 Luna price" }));
  const input = screen.getByLabelText("GPT-6 Luna input price");
  await user.clear(input);
  await user.type(input, "abc");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await user.clear(input);
  await user.type(input, "0.12");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(client.setPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ coachingPrices: { "gpt-6-luna": { input: "0.12", output: "0.50", checkedOn: toLocalDate(new Date()) } } })));
  expect(await screen.findByText(/entered by you/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Use the built-in GPT-6 Luna price" }));
  await waitFor(() => expect(client.setPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ coachingPrices: {} })));
});
