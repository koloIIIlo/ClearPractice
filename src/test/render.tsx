import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";
import { TooltipProvider } from "@/components/ui/tooltip";

export type AppRenderOptions = {
  /** Defaults to a fresh mock client. */
  client?: IpcClient;
  /** Where the router starts, e.g. "/sessions?date=2026-10-12". */
  path?: string;
  /** Router location state, e.g. Practice complete's sessionIds. */
  state?: unknown;
  /** Other routes next to the component, e.g. { path: "/sessions/trash", element: <p>Trash page</p> }. */
  routes?: { path: string; element: ReactNode }[];
};

/**
 * Renders a component as the app would (roadmap 7.7): a memory router, a fresh
 * query client without retries, the IPC context and a toaster.
 */
export function renderWithApp(ui: ReactNode, opts: AppRenderOptions = {}): RenderResult & { client: IpcClient; queryClient: QueryClient } {
  const client = opts.client ?? createMockClient();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const url = new URL(opts.path ?? "/", "http://app.test");
  const entry = { pathname: url.pathname, search: url.search, state: opts.state ?? null };
  const result = render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={queryClient}>
        <IpcContext.Provider value={client}>
          <TooltipProvider>
          <Toaster />
          {opts.routes ? (
            <Routes>
              <Route path="*" element={ui} />
              {opts.routes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
            </Routes>
          ) : (
            ui
          )}
          </TooltipProvider>
        </IpcContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...result, client, queryClient };
}
