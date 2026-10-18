import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TalkSection } from "@/lib/ipc/schemas";
import { CueCardDeck } from "./CueCards";

const SECTIONS: TalkSection[] = ["Opening", "What we built", "How it works", "Close"].map((title, i) => ({
  id: `section-${i + 1}`, position: i + 1, title, keywords: i === 1 ? ["search", "filters"] : [], notes: "Not on the card", targetSeconds: 30 + i * 30,
}));

function Deck({ onExit }: { onExit: () => void }) {
  const [index, setIndex] = useState(0);
  return <CueCardDeck sections={SECTIONS} index={index} onIndex={setIndex} onExit={onExit} />;
}

const card = () => screen.getByRole("heading", { level: 2 }).textContent;

describe("cue cards (14.3)", () => {
  it("moves with arrows, PageDown and Space and exits with Escape", async () => {
    const user = userEvent.setup();
    const exit = vi.fn();
    render(<Deck onExit={exit} />);
    expect(card()).toBe("Opening");
    expect(screen.getByText("1 of 4")).toBeInTheDocument();
    expect(screen.getByText("Target 0:30")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(card()).toBe("What we built");
    expect(screen.getByRole("list", { name: "Keywords" })).toHaveTextContent("searchfilters");
    expect(screen.queryByText("Not on the card")).not.toBeInTheDocument();
    await user.keyboard("{PageDown}");
    expect(card()).toBe("How it works");
    await user.keyboard(" ");
    expect(card()).toBe("Close");
    await user.keyboard(" ");
    expect(card(), "the last card stays").toBe("Close");
    await user.keyboard("{ArrowLeft}");
    expect(card()).toBe("How it works");
    await user.keyboard("{PageUp}");
    expect(card()).toBe("What we built");
    expect(exit).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("leaves Space to a focused button and typing to fields", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Deck onExit={() => {}} />
        <input aria-label="Somewhere to type" />
      </>,
    );
    screen.getByRole("button", { name: "Next card" }).focus();
    await user.keyboard(" ");
    // Space pressed the focused Next button once, and the deck didn't move a second time.
    expect(card()).toBe("What we built");
    await user.click(screen.getByRole("textbox", { name: "Somewhere to type" }));
    await user.keyboard("{ArrowRight}{PageDown} ");
    expect(card()).toBe("What we built");
  });
});
