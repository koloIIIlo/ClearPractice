import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, useSearchParams } from "react-router";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { TimeCapsulePage } from "./TimeCapsule";

function Compare() {
  const [params] = useSearchParams();
  return <p>Compare {params.get("a")} with {params.get("b")}</p>;
}

function renderCapsule(client: IpcClient) {
  const router = createMemoryRouter(
    [
      { path: "/capsule", element: <TimeCapsulePage /> },
      { path: "/compare", element: <Compare /> },
    ],
    { initialEntries: ["/capsule"] },
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <IpcContext.Provider value={client}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </IpcContext.Provider>
    </QueryClientProvider>,
  );
  return router;
}

describe("the time capsule (14.5)", () => {
  it("opens the comparison with the first take", async () => {
    const user = userEvent.setup();
    const client = createMockClient();
    renderCapsule(client);
    // The sample history's baseline is the capsule's question.
    expect(await screen.findByText("Describe something you would like to get better at and why.")).toBeInTheDocument();
    const record = await screen.findByRole("button", { name: "Record" });
    await waitFor(() => expect(record).toBeEnabled());
    await user.click(record);
    const stop = await screen.findByRole("button", { name: /Stop and save/ });
    await act(() => new Promise((resolve) => setTimeout(resolve, 1_200)));
    await user.click(stop);
    const compare = await screen.findByRole("link", { name: "Compare with your first" }, { timeout: 5_000 });
    const session = (await client.listSessions()).find((s) => s.exerciseType === "capsule")!;
    const take = (await client.getSession(session.id)).attempts[0].id;
    expect(compare).toHaveAttribute("href", `/compare?a=s-07-a1&b=${take}`);
    // Measures sit side by side as then and now.
    expect(await screen.findByRole("table", { name: "Your first answer and your latest, side by side" })).toBeInTheDocument();
    expect(screen.getByText("Your first capsule. Next month's joins it here.")).toBeInTheDocument();
    await user.click(compare);
    expect(await screen.findByText(`Compare s-07-a1 with ${take}`)).toBeInTheDocument();
  });
});
