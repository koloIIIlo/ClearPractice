import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { UpgradeRun } from "@/lib/ipc/schemas";
import { renderWithRouter } from "@/test/render";
import { UpgradeLoop } from "./UpgradeLoop";

const run: UpgradeRun = {
  id: "upgrade-1-1760600000000-1", attemptId: "take-1", sessionId: "s-1", takeOrdinal: 2, revisionId: "rev-1", provider: "OpenAI", model: "gpt-6-luna",
  sentText: "Task: Explain an index.", transcriptText: "So, um, the index makes the searching more fast.", upgraded: "The index makes searching faster. It keeps its keys in order.",
  changes: [{ from: "makes the searching more fast", to: "makes searching faster", why: "Faster is the usual comparative." }],
  estimatedCostMicroUsd: 900, loopSessionId: "upgrade-1-1760600000000-1-loop", createdAt: "2026-10-18T10:00:00.000Z",
};

const renderLoop = (client: IpcClient) =>
  renderWithRouter([{ path: "/upgrade/:runId", element: <UpgradeLoop run={run} /> }, { path: "*", element: <p>Elsewhere</p> }], { client, path: `/upgrade/${run.id}` });

/** Records a take once the microphone list has loaded. */
async function record(user: ReturnType<typeof userEvent.setup>, name: string) {
  const start = await screen.findByRole("button", { name }, { timeout: 3_000 });
  await waitFor(() => expect(start).toBeEnabled());
  await user.click(start);
  const stop = await screen.findByRole("button", { name: "Stop and save" }, { timeout: 3_000 });
  await waitFor(() => expect(stop).toBeEnabled());
  await user.click(stop);
}

it("hides the upgraded text during retell", async () => {
  const user = userEvent.setup();
  renderLoop(createMockClient());
  // Compare: both versions, word by word, and what changed.
  expect(screen.getByText(run.upgraded)).toBeInTheDocument();
  expect(screen.getByText(run.transcriptText)).toBeInTheDocument();
  const removed = [...document.querySelectorAll("del")].map((d) => d.textContent);
  expect(removed).toEqual(["removed: So, um,", "removed: the", "removed: more fast."]);
  expect([...document.querySelectorAll("ins")].map((d) => d.textContent)).toContain("added: faster. It keeps its keys in order.");
  expect(screen.getByText(/“makes the searching more fast” → “makes searching faster”/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next: shadow it" }));
  expect(screen.getByRole("list", { name: "Sentences" })).toHaveTextContent("The index makes searching faster.");
  await record(user, "Record your shadowing");
  expect(await screen.findByRole("heading", { name: "Retell it from memory" }, { timeout: 3_000 })).toBeInTheDocument();
  expect(screen.queryByText(run.upgraded)).toBeNull();
  expect(screen.queryByText("The index makes searching faster.")).toBeNull();
  expect(screen.queryByRole("list", { name: "Sentences" })).toBeNull();
});

it("records shadow and retell takes with their step keys", async () => {
  const user = userEvent.setup();
  const client = createMockClient();
  const start = vi.spyOn(client, "startRecording");
  renderLoop(client);
  await user.click(screen.getByRole("button", { name: "Next: shadow it" }));
  await record(user, "Record your shadowing");
  await record(user, "Record your retelling");
  expect(await screen.findByRole("heading", { name: "Done" }, { timeout: 3_000 })).toBeInTheDocument();
  expect(start.mock.calls.map((c) => c[0].context?.step)).toEqual([{ index: 1, key: "shadow" }, { index: 2, key: "retell" }]);
  for (const call of start.mock.calls) {
    expect(call[0].context).toMatchObject({ sessionId: run.loopSessionId, exerciseId: "ex-upgrade", exerciseType: "upgrade", activity: { version: 1, seed: run.id, params: { sourceAttemptId: run.attemptId } } });
  }
  // The retell take completes the loop (appendix B: 20 XP).
  await waitFor(async () => expect((await client.listPracticeEvents()).filter((e) => e.kind === "upgrade").map((e) => [e.refId, e.xp])).toEqual([[run.loopSessionId, 20]]));
  const compare = screen.getByRole("link", { name: "Compare your first answer and your retelling" });
  expect(compare.getAttribute("href")).toMatch(new RegExp(`^/compare\\?a=${run.attemptId}&b=`));
});
