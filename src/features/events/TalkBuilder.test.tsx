import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import { renderWithApp } from "@/test/render";
import { choose } from "@/test/select";
import { parseTarget, TalkBuilderPage } from "./TalkBuilder";

const titles = () => within(screen.getByRole("list", { name: "Sections" })).getAllByRole("textbox", { name: /^Section \d+$/ }).map((i) => (i as HTMLInputElement).value);

describe("the talk builder (14.3)", () => {
  it("applies a template, reorders by keyboard and totals the targets", async () => {
    const user = userEvent.setup();
    const client = createMockClient();
    const save = vi.spyOn(client, "saveTalk");
    renderWithApp(<p>Elsewhere</p>, { client, path: "/events/talks/new", routes: [{ path: "/events/talks/:talkId", element: <TalkBuilderPage /> }] });
    // A new talk starts from the Classic template: 0:30, three points of 1:20 and 0:30.
    expect(await screen.findByText("Sections 5:00 in total")).toBeInTheDocument();
    expect(titles()).toEqual(["Opening", "Point 1", "Point 2", "Point 3", "Close"]);
    await choose(user, screen.getByRole("combobox", { name: "Template" }), "Story");
    expect(titles()).toEqual(["Situation", "Complication", "Resolution", "Lesson"]);
    expect(screen.getByText("Sections 5:00 in total")).toBeInTheDocument();

    // By keyboard: focus Move down on the first section and press Enter twice; focus follows the section.
    screen.getByRole("button", { name: "Move section 1 down" }).focus();
    await user.keyboard("{Enter}");
    expect(titles()).toEqual(["Complication", "Situation", "Resolution", "Lesson"]);
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName("Move section 2 down"));
    await user.keyboard("{Enter}");
    expect(titles()).toEqual(["Complication", "Resolution", "Situation", "Lesson"]);
    await user.click(screen.getByRole("button", { name: "Move section 4 up" }));
    expect(titles()).toEqual(["Complication", "Resolution", "Lesson", "Situation"]);

    // Targets total as you type; a time that isn't one says so.
    const target = screen.getAllByRole("textbox", { name: "Target" })[0];
    await user.clear(target);
    await user.type(target, "2:00");
    expect(screen.getByText("Sections 5:30 in total")).toBeInTheDocument();
    await user.clear(target);
    await user.type(target, "soon");
    expect(screen.getByText(/Use minutes and seconds/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(target);
    await user.type(target, "90");

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Team demo");
    await user.type(screen.getByRole("textbox", { name: "Keyword for section 1" }), "search{Enter}");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const sent = save.mock.calls[0][0];
    expect(sent.template).toBe("story");
    expect(sent.sections.map((s) => [s.title, s.targetSeconds])).toEqual([["Complication", 90], ["Resolution", 105], ["Lesson", 60], ["Situation", 45]]);
    expect(sent.sections[0].keywords).toEqual(["search"]);
    expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();
  });

  it("reads targets as minutes and seconds or seconds, between 5 seconds and an hour", () => {
    expect([parseTarget("1:30"), parseTarget("0:05"), parseTarget("90"), parseTarget(" 60:00 ")]).toEqual([90, 5, 90, 3600]);
    expect([parseTarget("0:04"), parseTarget("60:01"), parseTarget("1:75"), parseTarget("soon"), parseTarget("")]).toEqual([null, null, null, null, null]);
  });
});
