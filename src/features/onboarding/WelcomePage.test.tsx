import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { WelcomePage } from "./WelcomePage";

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function setup() {
  const base = createMockClient();
  const client: IpcClient = { ...base, setPreferences: vi.fn(base.setPreferences) };
  render(
    <MemoryRouter initialEntries={["/welcome"]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IpcContext.Provider value={client}>
          <Routes>
            <Route path="/welcome" element={<WelcomePage />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}

it("walks four skippable steps, keeps your goals, and ends at the optional baseline (4.19)", async () => {
  const user = userEvent.setup();
  const client = setup();
  expect(screen.getByRole("button", { name: /1\s*Your goal/ })).toHaveAttribute("aria-current", "step");
  await user.click(await screen.findByRole("button", { name: /Less hesitation/ }));
  await waitFor(() => expect(client.setPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ goals: ["hesitation"] })));
  await user.click(screen.getByRole("radio", { name: "Also in my strongest language" }));
  await waitFor(() => expect(client.setPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ difficultyLanguage: "both" })));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("button", { name: /2\s*Microphone/ })).toHaveAttribute("aria-current", "step");
  expect(screen.getByLabelText("Input device")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("heading", { name: "AI feedback" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByText("“Describe something you would like to get better at and why.”")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Record the baseline" }));
  expect(screen.getByTestId("where")).toHaveTextContent("/practice/ex-repeat?prompt=baseline");
  expect(client.setPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ onboarded: true, goals: ["hesitation"] }));
});

it("can be skipped from the first step", async () => {
  const user = userEvent.setup();
  const client = setup();
  await user.click(screen.getByRole("button", { name: "Skip setup" }));
  expect(screen.getByTestId("where")).toHaveTextContent("/");
  expect(client.setPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ onboarded: true }));
});
