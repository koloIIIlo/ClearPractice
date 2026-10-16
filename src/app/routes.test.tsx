import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import App from "@/App";
import { createMockClient } from "@/lib/ipc/mock-client";
import { ROUTE_MODULES } from "./prefetch";

afterEach(() => {
  window.location.hash = "#/";
});

/** Pages loaded on first visit (roadmap 7.1) and the main heading each shows. */
const LAZY_PAGES: [string, string][] = [
  ["/exercises", "Exercises"],
  ["/sessions", "Sessions"],
  ["/sessions/trash", "Trash"],
  ["/phrases", "Phrases"],
  ["/progress", "Progress"],
  ["/settings/practice", "Settings"],
  ["/welcome", "Welcome to ClearPractice"],
  ["/practice/done", "Practice complete"],
  ["/compare?a=s-01-a1&b=s-02-a1", "Compare takes"],
];

it("loads each lazy page on first visit and shows its heading", async () => {
  for (const [path, heading] of LAZY_PAGES) {
    window.location.hash = `#${path}`;
    render(<App client={createMockClient()} />);
    expect(await screen.findByRole("heading", { level: 1, name: heading }, { timeout: 8000 }), path).toBeInTheDocument();
    cleanup();
  }
}, 60_000);

it("opens the studio with its recorder", async () => {
  window.location.hash = "#/practice/ex-repeat";
  render(<App client={createMockClient()} />);
  expect(await screen.findByRole("button", { name: /^Record$/ }, { timeout: 8000 })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Practice studio");
}, 20_000);

it("prefetches the same modules the routes load", async () => {
  const loaded = await Promise.all(Object.values(ROUTE_MODULES).map((load) => load()));
  for (const mod of loaded) expect(Object.keys(mod as object).some((k) => k.endsWith("Page"))).toBe(true);
}, 20_000);
