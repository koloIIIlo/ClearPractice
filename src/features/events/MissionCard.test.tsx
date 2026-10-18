import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { missionById } from "@/content/missions";
import { ProgressPage } from "@/features/progress/ProgressPage";
import { KINDS } from "@/features/progress/reflection-options";
import { weekStart } from "@/lib/engagement/weekly";
import { createMockClient } from "@/lib/ipc/mock-client";
import { toLocalDate } from "@/lib/phrase-schedule";
import { renderWithApp } from "@/test/render";
import { MissionCard } from "./MissionCard";

const week = () => weekStart(toLocalDate(new Date()), "monday");
const card = () => renderWithApp(<ul><MissionCard /></ul>, { client: createMockClient(), routes: [{ path: "/progress", element: <ProgressPage /> }] });

describe("this week's mission (14.1)", () => {
  it("offers one mission of each difficulty, another three on request, and a skip", async () => {
    const user = userEvent.setup();
    const { client } = card();
    const offers = await screen.findByRole("list", { name: "Missions to choose from" });
    const first = within(offers).getAllByRole("listitem").map((li) => li.textContent);
    expect(first).toHaveLength(3);
    expect(first.map((t) => t?.match(/Easy|Medium|Stretch/)?.[0])).toEqual(["Easy", "Medium", "Stretch"]);
    await user.click(screen.getByRole("button", { name: "Choose another" }));
    const second = within(screen.getByRole("list", { name: "Missions to choose from" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(second.filter((t) => first.includes(t))).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Skip this week" }));
    expect(await screen.findByText("No mission this week")).toBeInTheDocument();
    expect((await client.getMissionPick(week()))?.missionId).toBeNull();
    await user.click(screen.getByRole("button", { name: "Choose one after all" }));
    expect(await screen.findByRole("list", { name: "Missions to choose from" })).toBeInTheDocument();
  });

  it("prefills the reflection form", async () => {
    const user = userEvent.setup();
    const { client } = card();
    const add = vi.spyOn(client, "addTransferReview");
    const pick = within(await screen.findByRole("list", { name: "Missions to choose from" })).getAllByRole("button", { name: /^Pick/ })[1];
    await user.click(pick);
    const chosen = await client.getMissionPick(week());
    const mission = missionById(chosen?.missionId)!;
    expect(await screen.findByText(mission.how)).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "I did it" }));

    // The reflection form, with the mission preselected and its title as the situation.
    const situation = await screen.findByRole("textbox", { name: "Situation" });
    expect(situation).toHaveValue(mission.title);
    expect(screen.getByRole("note")).toHaveTextContent(`Logging this week's mission: ${mission.title}`);
    const kinds = within(screen.getByRole("toolbar", { name: "What kind of conversation?" }));
    for (const tag of mission.tags) expect(kinds.getByRole("button", { name: KINDS.find((k) => k.value === tag)!.label })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Save reflection" }));
    await waitFor(() => expect(add).toHaveBeenCalledWith(expect.objectContaining({ situation: mission.title, missionId: mission.id, tags: mission.tags })));
    await waitFor(async () => expect((await client.getMissionPick(week()))?.doneAt).not.toBeNull());
    expect(await screen.findByText("Mission logged with your reflection.")).toBeInTheDocument();
  });
});
