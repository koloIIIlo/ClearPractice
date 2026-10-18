import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import { renderWithApp } from "@/test/render";
import { ProgressPage } from "@/features/progress/ProgressPage";
import { AfterActionForm } from "./AfterActionForm";

it("saves the four answers and the listener's words separately", async () => {
  const user = userEvent.setup();
  const client = createMockClient();
  const add = vi.spyOn(client, "addTransferReview");
  renderWithApp(<AfterActionForm />, { client });
  const save = screen.getByRole("button", { name: "Save review" });
  await user.type(screen.getByRole("textbox", { name: "What was the talk?" }), "Weekly update to the team");
  expect(save).toBeDisabled();
  await user.type(screen.getByRole("textbox", { name: "What did you plan to do?" }), "Open with the decision");
  await user.type(screen.getByRole("textbox", { name: "What actually happened?" }), "I opened with the history");
  await user.type(screen.getByRole("textbox", { name: "What will you do next time?" }), "Decision first");
  await user.click(screen.getByText("More (optional)"));
  await user.type(screen.getByRole("textbox", { name: "What did the listener understand? (their words)" }), "You want to delay the release");
  await user.click(save);
  await waitFor(() =>
    expect(add).toHaveBeenCalledWith(expect.objectContaining({
      kind: "aar", situation: "Weekly update to the team", listenerText: "You want to delay the release", selfReport: "",
      extra: { planned: "Open with the decision", happened: "I opened with the history", why: "", nextTime: "Decision first" },
    })),
  );
  const events = await client.listPracticeEvents();
  expect(events.filter((e) => ["transfer_review", "after_action"].includes(e.kind)).map((e) => e.kind).sort()).toEqual(["after_action", "transfer_review"]);
});

it("lists an after-action review with its badge and four answers in Real conversations", async () => {
  const user = userEvent.setup();
  renderWithApp(<ProgressPage />, { path: "/progress?view=real&form=aar" });
  expect(await screen.findByRole("form", { name: "After-action review" })).toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "What was the talk?" }), "Weekly update to the team");
  await user.type(screen.getByRole("textbox", { name: "What actually happened?" }), "I opened with the history");
  await user.click(screen.getByRole("button", { name: "Save review" }));
  const item = (await screen.findAllByText("Weekly update to the team")).find((n) => n.closest("li"))!.closest("li")!;
  expect(item).toHaveTextContent("After-action");
  expect(item).toHaveTextContent("What actually happened?I opened with the history");
  expect(item).toHaveTextContent("Your note");
});
