import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { buildEventPlan } from "@/lib/events/plan";
import { createMockClient } from "@/lib/ipc/mock-client";
import { addLocalDays, toLocalDate } from "@/lib/phrase-schedule";
import { renderWithApp } from "@/test/render";
import { EventPage } from "./EventPage";
import { TodayRealWorld } from "./TodayRealWorld";

const today = () => toLocalDate(new Date());

describe("event mode (14.2)", () => {
  it("opens each item's action", async () => {
    const user = userEvent.setup();
    const client = createMockClient();
    // An interview in two weeks: its plan has every kind of item, the mock included.
    const event = await client.saveEvent({ title: "Interview at Initech", kind: "interview", localDate: addLocalDays(today(), 14), startTime: "09:30", minutes: 30, audience: "", goal: "" });
    await client.saveEventPlan(event.id, buildEventPlan(event, today()));
    renderWithApp(<EventPage />, {
      client,
      path: `/events/${event.id}`,
      routes: [
        { path: "/events/:eventId", element: <EventPage /> },
        { path: "/events/talks/:talkId", element: <p>Talk builder</p> },
        { path: "/progress", element: <p>Progress page</p> },
      ],
    });
    expect(await screen.findByRole("heading", { name: "Interview at Initech" })).toBeInTheDocument();
    const href = (name: string) => screen.getByRole("link", { name }).getAttribute("href");
    expect(screen.getAllByRole("link", { name: "Rehearse" }).map((a) => a.getAttribute("href"))).toEqual(
      Array(3).fill(`/events/talks/new?event=${event.id}&template=star`),
    );
    expect(href("Q&A drill")).toBe("/drill/boss?boss=job-interview");
    expect(href("Start the mock")).toBe("/partner?scenario=job-interview");
    expect(href("Start the routine")).toBe(`/confidence/routine?event=${event.id}`);
    expect(href("Write the debrief")).toBe(`/progress?view=real&form=aar&event=${event.id}`);
    // Outline: builds the talk from the STAR template, links it and opens the builder.
    await user.click(screen.getByRole("button", { name: "Build the outline" }));
    expect(await screen.findByText("Talk builder")).toBeInTheDocument();
    const linked = await client.getEvent(event.id);
    expect(linked.event.talkId).not.toBeNull();
    expect((await client.getTalk(linked.event.talkId!)).sections.map((s) => s.title)).toEqual(["Situation", "Task", "Action", "Result"]);
    expect(linked.items[0]).toMatchObject({ kind: "outline", refId: linked.event.talkId });
  });

  it("ticks an item by hand and keeps it as you set it", async () => {
    const user = userEvent.setup();
    renderWithApp(<EventPage />, { path: "/events/event-sample", routes: [{ path: "/events/:eventId", element: <EventPage /> }] });
    expect(await screen.findByRole("heading", { name: "Interview at Acme" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark Q&A drill as done" }));
    expect(await screen.findByText("Done (ticked by you)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark Q&A drill as not done" }));
    await waitFor(() => expect(screen.queryByText("Done (ticked by you)")).not.toBeInTheDocument());
    // Nothing is red and nothing counts down: an earlier item's day is just a day.
    expect(document.querySelector(".text-destructive")).toBeNull();
  });

  it("Today shows the next item", async () => {
    const client = createMockClient();
    const event = await client.saveEvent({ title: "Team demo", kind: "talk", localDate: addLocalDays(today(), 2), startTime: null, minutes: 10, audience: "", goal: "" });
    await client.saveEventPlan(event.id, buildEventPlan(event, today()));
    renderWithApp(<ul><TodayRealWorld /></ul>, { client });
    expect(await screen.findByText("Team demo in 2 days")).toBeInTheDocument();
    expect(screen.getByText("Today: outline your talk")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the plan" })).toHaveAttribute("href", `/events/${event.id}`);
    // The sample interview, six days away, waits behind the sooner event.
    expect(screen.queryByText(/Interview at Acme/)).not.toBeInTheDocument();
  });
});
