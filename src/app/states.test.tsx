import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "@/App";
import { IpcError, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";

/**
 * Plan 1.9: every main screen shows a real error (with Try again) when the
 * native side fails, and a real empty state when there is nothing yet, while the
 * shell stays usable. Never a blank page or an endless spinner.
 */
const ROUTES = ["#/", "#/exercises", "#/sessions", "#/sessions/trash", "#/phrases", "#/progress"];

function failing(): IpcClient {
  const base = createMockClient();
  const client = { ...base } as Record<string, unknown>;
  for (const [name, value] of Object.entries(base)) {
    if (typeof value === "function" && /^(get|list)/.test(name)) {
      client[name] = async () => {
        throw new IpcError("storage_unavailable", "Session storage is unavailable.");
      };
    }
  }
  return client as unknown as IpcClient;
}

function empty(): IpcClient {
  const base = createMockClient();
  return {
    ...base,
    listSessions: async () => [],
    listPhrases: async () => [],
    listExercises: async () => [],
    listPrompts: async () => [],
    listRecordings: async () => [],
    listRecoverableRecordings: async () => [],
    listTrash: async () => ({ ...(await base.listTrash()), items: [] }),
  };
}

describe("screen states (1.9)", () => {
  for (const route of ROUTES) {
    it(`shows an error with Try again on ${route} when loading fails`, async () => {
      window.location.hash = route;
      render(<App client={failing()} />);
      // A whole app render with retried failures: allow for a busy test worker (the full suite runs in one).
      await waitFor(() => expect(screen.getAllByRole("alert").some((a) => /Session storage is unavailable/.test(a.textContent ?? ""))).toBe(true), { timeout: 10_000 });
      expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("link", { name: "Today" }).length).toBeGreaterThan(0); // shell still usable
    }, 15_000);
  }

  for (const route of ["#/sessions", "#/sessions/trash", "#/phrases", "#/exercises"]) {
    it(`shows an empty state on ${route} when there is nothing yet`, async () => {
      window.location.hash = route;
      const { container } = render(<App client={empty()} />);
      await screen.findByRole("heading", { level: 1 }, { timeout: 5000 });
      await waitFor(() => expect(container.querySelector(".border-dashed"), `${route} has no empty state`).not.toBeNull(), { timeout: 5000 });
      expect(screen.queryByRole("alert")).toBeNull();
    });
  }
});
