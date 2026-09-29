import { createContext, useContext } from "react";
import type { IpcClient } from "./client";

export type { IpcClient, SessionFilter } from "./client";
export { IpcError } from "./client";

export const IpcContext = createContext<IpcClient | null>(null);

export function useIpc(): IpcClient {
  const client = useContext(IpcContext);
  if (!client) throw new Error("useIpc must be used inside <IpcContext.Provider>");
  return client;
}
