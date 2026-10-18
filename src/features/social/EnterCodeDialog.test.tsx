import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { PROMPTS } from "@/content/prompts";
import { ROULETTE_TOPICS } from "@/content/roulette-topics";
import { DRILL_MODULES } from "@/features/drills/drill-module";
import { encodeChallenge } from "@/lib/social/codes";
import { renderWithApp } from "@/test/render";
import { EnterCodeDialog } from "./EnterCodeDialog";
import { ShareChallenge } from "./ShareChallenge";

function Destination() {
  const location = useLocation();
  return <p>{location.pathname}{location.search}</p>;
}

describe("Enter a code", () => {
  it("enables Play for a valid code and navigates with the drill options", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithApp(<EnterCodeDialog open onOpenChange={onOpenChange} />, { routes: [{ path: "/drill/:drillId", element: <Destination /> }] });
    const play = screen.getByRole("button", { name: "Play" });
    expect(play).toBeDisabled();
    const topic = ROULETTE_TOPICS.work[2].id;
    const code = encodeChallenge("roulette", "7KX2M9QA", { category: "work", topic, speak: 90, respun: "true" });
    await user.type(screen.getByRole("textbox", { name: "Challenge code" }), code.toLowerCase());
    expect(play).toBeEnabled();
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "false");
    await user.click(play);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(await screen.findByText(`/drill/roulette?seed=7KX2M9QA&category=work&topic=${topic}&speak=90&respun=true`)).toBeInTheDocument();
  });

  it("shows the typo message as the code is typed", async () => {
    const user = userEvent.setup();
    renderWithApp(<EnterCodeDialog open onOpenChange={() => {}} />);
    const input = screen.getByRole("textbox", { name: "Challenge code" });
    const code = encodeChallenge("jam", "7KX2M9QA");
    const typo = code.slice(0, -1) + (code.endsWith("0") ? "1" : "0");
    await user.type(input, typo);
    const message = "That code doesn't look right. Check the last two characters.";
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(message);
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    await user.clear(input);
    await user.type(input, code);
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
  });
});

describe("Share challenge", () => {
  it("copies the played challenge and explains clipboard errors", async () => {
    const user = userEvent.setup();
    const module = await DRILL_MODULES.jam();
    const ctx = { prompts: PROMPTS, today: "2026-10-18" };
    const plan = module.plan("7KX2M9QA", {}, ctx);
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    renderWithApp(<ShareChallenge plan={plan} ctx={ctx} />);
    await user.click(await screen.findByRole("button", { name: "Share challenge" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(`Try my Just a Minute challenge in ClearPractice: ${encodeChallenge("jam", plan.seed, { topic: String(plan.params.topic) })}`));
    expect(await screen.findByText("Challenge copied.")).toBeInTheDocument();
    copy.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    await user.click(screen.getByRole("button", { name: "Share challenge" }));
    expect(await screen.findByText("The clipboard isn't available here.")).toBeInTheDocument();
    copy.mockRestore();
  });

  it("hides the action for a typed pitch idea", async () => {
    const module = await DRILL_MODULES.pitch();
    const ctx = { prompts: PROMPTS, today: "2026-10-18" };
    const shareable = module.plan("7KX2M9QA", { prompt: "p-remote" }, ctx);
    const result = renderWithApp(<ShareChallenge plan={shareable} ctx={ctx} />);
    expect(await screen.findByRole("button", { name: "Share challenge" })).toBeInTheDocument();
    const typed = module.plan("7KX2M9QA", { idea: "My own idea" }, ctx);
    result.rerender(<ShareChallenge plan={typed} ctx={ctx} />);
    expect(screen.queryByRole("button", { name: "Share challenge" })).not.toBeInTheDocument();
  });
});
