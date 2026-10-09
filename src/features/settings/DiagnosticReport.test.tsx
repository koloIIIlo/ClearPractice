import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { DiagnosticReport } from "./DiagnosticReport";

it("shows the whole report before saving exactly that text (6.7)", async () => {
  const user = userEvent.setup();
  const text = '{\n  "report": "ClearPractice diagnostic report"\n}';
  const client: IpcClient = { ...createMockClient(), recordingMode: "native", buildDiagnostics: vi.fn(async () => text), saveDiagnostics: vi.fn(async () => "clearpractice-diagnostics.json") };
  render(<QueryClientProvider client={new QueryClient()}><IpcContext.Provider value={client}><DiagnosticReport /></IpcContext.Provider></QueryClientProvider>);
  expect(screen.queryByRole("button", { name: "Save to a file…" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Prepare a diagnostic report" }));
  expect(await screen.findByLabelText("Diagnostic report")).toHaveTextContent("ClearPractice diagnostic report");
  await user.click(screen.getByRole("button", { name: "Save to a file…" }));
  expect(client.saveDiagnostics).toHaveBeenCalledWith(text);
  expect(await screen.findByText("Saved as clearpractice-diagnostics.json.")).toBeInTheDocument();
});
