import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router/dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/app/theme";
import { createRouter } from "@/app/routes";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createMockClient } from "@/lib/ipc/mock-client";

// M1: sample data only. The Tauri invoke client replaces this once native commands exist (M2).
const defaultClient = createMockClient();

export default function App({ client = defaultClient }: { client?: IpcClient }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // Local IPC: no network retries or refetch-on-focus storms.
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
        },
      }),
  );
  const [router] = useState(createRouter);

  return (
    <ThemeProvider>
      <IpcContext.Provider value={client}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={400}>
            <RouterProvider router={router} />
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </QueryClientProvider>
      </IpcContext.Provider>
    </ThemeProvider>
  );
}
