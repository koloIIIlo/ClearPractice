import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { ApiCredentialSettings } from "./ApiCredentialSettings";

function setup(client: IpcClient) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queries}><IpcContext.Provider value={client}><ApiCredentialSettings /></IpcContext.Provider></QueryClientProvider>);
  return { queries, user: userEvent.setup() };
}

describe("credential controls", () => {
  it("stores, clears the input, and removes a key without retaining it in query or mutation caches", async () => {
    const client = { ...createMockClient(), recordingMode: "native" as const,
      storeApiKey: vi.fn(async () => ({ provider: "OpenAI" as const, present: true })),
      removeApiKey: vi.fn(async () => ({ provider: "OpenAI" as const, present: false })),
    };
    const { queries, user } = setup(client);
    await screen.findByText("No key stored");
    const secret = "fake-development-key";
    await user.type(screen.getByLabelText("API key"), secret);
    await user.click(screen.getByRole("button", { name: "Save key" }));
    await screen.findByText("Key stored · hidden");
    expect(client.storeApiKey).toHaveBeenCalledWith(secret);
    expect(screen.getByLabelText("Replacement API key")).toHaveValue("");
    expect(JSON.stringify(queries.getQueryCache().getAll().map((query) => query.state.data))).not.toContain(secret);
    expect(queries.getMutationCache().getAll()).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Remove key" }));
    await screen.findByText("API key removed.");
    expect(client.removeApiKey).toHaveBeenCalledOnce();
  });

  it("does not echo a secret even when the native error contains it", async () => {
    const secret = "fake-error-secret";
    const client = { ...createMockClient(), recordingMode: "native" as const,
      storeApiKey: vi.fn(async () => { throw new Error(secret); }),
    };
    const { user } = setup(client);
    await screen.findByText("No key stored");
    await user.type(screen.getByLabelText("API key"), secret);
    await user.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(screen.getByRole("alert")).not.toHaveTextContent(secret));
    expect(screen.getByLabelText("API key")).toHaveValue("");
  });

  it("disables key entry in the browser preview", () => {
    setup(createMockClient());
    expect(screen.getByLabelText("API key")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save key" })).toBeDisabled();
  });
});
