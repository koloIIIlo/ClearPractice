import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import { renderWithApp } from "@/test/render";
import { ImportListenerAnswers, ListenerAnswers } from "./ListenerAnswers";

describe("a listener's answers (14.4)", () => {
  it("shows the listener's words apart from your notes", async () => {
    const user = userEvent.setup();
    const client = createMockClient();
    await client.exportListenerPack("s-06-a1", ["What was my main point?", "What helped you follow?"], "Alex", false);
    const judge = vi.spyOn(client, "setListenerJudgement");
    renderWithApp(
      <>
        <p>Your note: the sequence was better in take 2.</p>
        <ImportListenerAnswers />
        <ListenerAnswers sessionId="s-06" title="Listeners' answers" withImport />
      </>,
      { client },
    );
    expect(await screen.findByText(/Waiting for a listener's answers/)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /Import listener answers/ })[0]);
    expect(await screen.findByText("Imported Sam's answers.")).toBeInTheDocument();

    const answers = within(await screen.findByRole("region", { name: "Listeners' answers" }));
    expect(answers.getByRole("heading", { name: "Listener's words: Sam" })).toBeInTheDocument();
    expect(answers.getByText("What was my main point?")).toBeInTheDocument();
    expect(answers.getByText("“That the release should wait two weeks so the tests can catch up.”")).toBeInTheDocument();
    expect(answers.getByText("Written by your listener, not by you or the app.")).toBeInTheDocument();
    // Your own note stays outside, and the listener's words never mix with it.
    expect(answers.queryByText(/the sequence was better/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Waiting for a listener's answers/)).not.toBeInTheDocument();

    // Whether they got your main point is your judgement.
    await user.click(answers.getByRole("radio", { name: "Yes" }));
    await waitFor(() => expect(judge).toHaveBeenCalledWith(expect.stringMatching(/^listener-/), true));

    // The same file again changes nothing.
    await user.click(screen.getAllByRole("button", { name: /Import listener answers/ })[0]);
    expect(await screen.findByText("These answers were already imported. Nothing changed.")).toBeInTheDocument();
    expect(answers.getAllByRole("heading", { name: /Listener's words/ })).toHaveLength(1);
  });
});
