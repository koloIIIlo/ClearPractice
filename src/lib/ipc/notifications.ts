import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

// Desktop-only facade over tauri-plugin-notification 2.7's commands. Keeping the
// bridge here also lets us await delivery errors (the guest sendNotification is void).
export async function requestNotificationPermission(): Promise<boolean> {
  if (z.boolean().nullable().parse(await invoke("plugin:notification|is_permission_granted"))) return true;
  return z.enum(["granted", "denied", "prompt", "prompt-with-rationale"])
    .parse(await invoke("plugin:notification|request_permission")) === "granted";
}
export async function showSurpriseNotification(prompt: string): Promise<void> {
  if (z.boolean().nullable().parse(await invoke("plugin:notification|is_permission_granted"))) {
    await invoke("plugin:notification|notify", { options: { title: "ClearPractice", body: `Surprise prompt: ${prompt}` } });
  }
}
