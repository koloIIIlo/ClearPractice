import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/** Opens a styled Select (no browser-default lists in the app) and picks the option whose name matches. */
export async function choose(user: UserEvent, trigger: HTMLElement, option: string | RegExp) {
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: option }));
}
