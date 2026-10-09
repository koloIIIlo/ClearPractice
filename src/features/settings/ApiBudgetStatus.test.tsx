import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { IpcContext } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { ApiBudgetStatus } from "./ApiBudgetStatus";

it("counts both purposes and keeps uncertain charges visible within one stop limit", async () => {
  const mock = createMockClient();
  const client = { ...mock, recordingMode: "native" as const, getApiUsageSummary: async () => ({
    ...await mock.getApiUsageSummary(), coachingMicroUsd: 3_000_000, transcriptionMicroUsd: 1_500_000,
    countedMicroUsd: 4_500_000, uncertainMicroUsd: 1_000_000, settledMicroUsd: 3_250_000, reservedMicroUsd: 250_000, remainingMicroUsd: 500_000, warning: true,
  }) };
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><ApiBudgetStatus /></IpcContext.Provider></QueryClientProvider>);
  await screen.findByText(/\$4\.50$/, { selector: "dd" });
  expect(screen.getByText(/\$3\.00$/, { selector: "dd" })).toBeVisible();
  expect(screen.getByText(/\$1\.50$/, { selector: "dd" })).toBeVisible();
  expect(screen.getByText(/\$0\.50$/, { selector: "dd" })).toBeVisible();
  expect(screen.getByText(/\$1.00 has an uncertain charge and stays counted/)).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("$4.00 warning");
  expect(screen.getByText(/\$5.00 stop limit/)).toBeVisible();
  // Billed, still open and uncertain are separate figures (3.17).
  expect(screen.getByText("Billed, from reported usage").nextSibling).toHaveTextContent("$3.25");
  expect(screen.getByText("Still open (being prepared or sent)").nextSibling).toHaveTextContent("$0.25");
  expect(screen.getByText(/^Uncertain/).nextSibling).toHaveTextContent("$1.00");
  expect(screen.getByLabelText("Warn me at")).toHaveValue("4000000");
});
