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
    countedMicroUsd: 4_500_000, uncertainMicroUsd: 1_000_000, remainingMicroUsd: 500_000, warning: true,
  }) };
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><ApiBudgetStatus /></IpcContext.Provider></QueryClientProvider>);
  await screen.findByText(/\$4\.50$/);
  expect(screen.getByText(/\$3\.00$/)).toBeVisible();
  expect(screen.getByText(/\$1\.50$/)).toBeVisible();
  expect(screen.getByText(/\$0\.50$/)).toBeVisible();
  expect(screen.getByText(/\$1.00 has an uncertain charge and stays counted/)).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("$4.00 warning");
  expect(screen.getByText(/\$5.00 stop limit/)).toBeVisible();
});
