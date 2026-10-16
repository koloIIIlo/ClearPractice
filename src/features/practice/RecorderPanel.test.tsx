import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { renderWithApp } from "@/test/render";
import { RecorderPanel, useRecorderGuard, type RecorderPanelProps } from "./RecorderPanel";
import { useRecorder } from "./recorder";

function Harness(props: Partial<RecorderPanelProps>) {
  const rec = useRecorder("Test take");
  return <RecorderPanel rec={rec} {...props} />;
}

function spyClient() {
  const base = createMockClient();
  return { ...base, startRecording: vi.fn(base.startRecording), stopRecording: vi.fn(base.stopRecording) } satisfies IpcClient;
}

const recordButton = (name: RegExp | string = /^Record$/) => screen.findByRole("button", { name });

it("renders the inside slot between the clock and the button", async () => {
  renderWithApp(<Harness inside={<p>Inside slot</p>} />);
  const button = await recordButton();
  const inside = screen.getByText("Inside slot");
  const clock = screen.getByLabelText("Elapsed time");
  expect(clock.compareDocumentPosition(inside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(inside.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("uses label overrides and a custom clock", async () => {
  renderWithApp(<Harness labels={{ record: "Start round" }} clock={<p>0:60 left</p>} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start round" })).toBeEnabled());
  expect(screen.getByText("0:60 left")).toBeInTheDocument();
  expect(screen.queryByLabelText("Elapsed time")).not.toBeInTheDocument();
});

it("starts at once without the countdown switch and calls onBeforeStart first", async () => {
  const client = spyClient();
  const before = vi.fn();
  renderWithApp(<Harness hideCountdown onBeforeStart={before} />, { client });
  expect(screen.queryByRole("switch", { name: "3-second countdown" })).not.toBeInTheDocument();
  const button = await recordButton();
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  await waitFor(() => expect(client.startRecording).toHaveBeenCalledTimes(1));
  expect(before).toHaveBeenCalledTimes(1);
  expect(before.mock.invocationCallOrder[0]).toBeLessThan(client.startRecording.mock.invocationCallOrder[0]);
});

it("Ctrl+Enter stops a take when no dialog is open", async () => {
  const client = spyClient();
  renderWithApp(<Harness />, { client });
  const button = await recordButton();
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  await screen.findByRole("button", { name: /Stop and save/ });
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  await waitFor(() => expect(client.stopRecording).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("Take complete")).toBeInTheDocument();
});

function Guarded() {
  const rec = useRecorder("Test take");
  const guard = useRecorderGuard(rec);
  return (
    <>
      <RecorderPanel rec={rec} />
      <Link to="/other">Leave</Link>
      {guard}
    </>
  );
}

it("asks before leaving while recording and saves on Stop and save", async () => {
  const client = spyClient();
  const router = createMemoryRouter([
    { path: "/", element: <Guarded /> },
    { path: "/other", element: <p>Other page</p> },
  ]);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <IpcContext.Provider value={client}>
        <RouterProvider router={router} />
      </IpcContext.Provider>
    </QueryClientProvider>,
  );
  const button = await recordButton();
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  await screen.findByRole("button", { name: /Stop and save/ });
  await userEvent.click(screen.getByRole("link", { name: "Leave" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent("A take is still recording");
  await userEvent.click(within(dialog).getByRole("button", { name: "Stop and save" }));
  await waitFor(() => expect(client.stopRecording).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("Other page")).toBeInTheDocument();
});

it("passes livePace to startRecording when enabled and shows the meter while recording", async () => {
  const user = userEvent.setup();
  const client = spyClient();
  await client.setPreferences({ ...(await client.getPreferences()), livePace: true });
  renderWithApp(<Harness />, { client });
  const button = await recordButton();
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  await waitFor(() => expect(client.startRecording).toHaveBeenCalledWith(expect.objectContaining({ livePace: true })));
  expect(await screen.findByTestId("live-pace")).toHaveTextContent("Listening…");
  await user.click(await screen.findByRole("button", { name: /Stop and save/ }));
  await waitFor(() => expect(screen.queryByTestId("live-pace")).not.toBeInTheDocument());
});

it("leaves live pace off by default", async () => {
  const client = spyClient();
  renderWithApp(<Harness />, { client });
  const button = await recordButton();
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  await waitFor(() => expect(client.startRecording).toHaveBeenCalledWith(expect.objectContaining({ livePace: false })));
  expect(screen.queryByTestId("live-pace")).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: /Stop and save/ }));
});
