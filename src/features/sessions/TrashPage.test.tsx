import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { sessions } from "@/lib/ipc/mock-data";
import { MoveToTrashButton, TrashPage } from "./TrashPage";

function renderWith(client: ReturnType<typeof createMockClient>, ui: React.ReactNode) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IpcContext.Provider value={client}>
          <Routes>
            <Route path="*" element={ui} />
          </Routes>
        </IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Trash", () => {
  it("states what moves to Trash and lists it with its permanent deletion date", async () => {
    const user = userEvent.setup();
    const client = createMockClient();
    const session = sessions[0];
    renderWith(client, <><MoveToTrashButton session={session} /><TrashPage /></>);
    await screen.findByText("Trash is empty");

    await user.click(screen.getByRole("button", { name: "Move to Trash" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(`${session.attemptCount} recording`);
    expect(dialog).toHaveTextContent("Nothing is deleted now");
    expect(dialog).toHaveTextContent("for 30 days");
    await user.click(within(dialog).getByRole("button", { name: "Move to Trash" }));

    const row = (await screen.findByText(session.title, { selector: "p" })).closest("tr")!;
    expect(row).toHaveTextContent(/after \d+ \w+ \d{4}/);
    await expect(client.getSession(session.id)).rejects.toMatchObject({ code: "not_found" });

    await user.click(within(row).getByRole("button", { name: `Restore ${session.title}` }));
    await screen.findByText("Trash is empty");
    await expect(client.getSession(session.id)).resolves.toMatchObject({ id: session.id });
  });

  it("deletes permanently only after confirmation and keeps the item when deletion fails", async () => {
    const user = userEvent.setup();
    const client = createMockClient();
    await client.moveSessionToTrash(sessions[0].id);
    const failing = { ...client, deleteSessionsPermanently: vi.fn<IpcClient["deleteSessionsPermanently"]>(async () => { throw new Error("Session storage is unavailable."); }) };
    renderWith(failing, <TrashPage />);

    await user.click(await screen.findByRole("button", { name: `Delete ${sessions[0].title} permanently` }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("cannot be undone");
    await user.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Session storage is unavailable.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(sessions[0].title, { selector: "p" })).toBeInTheDocument();

    failing.deleteSessionsPermanently = vi.fn((ids: string[]) => client.deleteSessionsPermanently(ids));
    await user.click(screen.getByRole("button", { name: `Delete ${sessions[0].title} permanently` }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete permanently" }));
    await screen.findByText("Trash is empty");
    expect(failing.deleteSessionsPermanently).toHaveBeenCalledWith([sessions[0].id]);
    await waitFor(async () => expect((await client.listTrash()).items).toHaveLength(0));
  });
});
