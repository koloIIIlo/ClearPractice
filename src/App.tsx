import { useLayoutEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router/dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/app/theme";
import { createRouter } from "@/app/routes";
import { IpcContext, type IpcClient } from "@/lib/ipc";
import { createAppClient } from "@/lib/ipc/native-client";

const defaultClient = createAppClient();

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
  const [router, setRouter] = useState<ReturnType<typeof createRouter> | null>(null);
  useLayoutEffect(() => {
    // Hash listeners belong to this mounted app. Creating the router in a layout
    // effect (before the first paint, so no blank frame) also lets StrictMode
    // dispose its first setup before recreating it.
    const next = createRouter();
    setRouter(next);
    return () => next.dispose();
  }, []);

  return (
    <ThemeProvider>
      <IpcContext.Provider value={client}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={400}>
            {router && <RouterProvider router={router} />}
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </QueryClientProvider>
      </IpcContext.Provider>
    </ThemeProvider>
  );
}
