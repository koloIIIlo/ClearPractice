import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { offending } from "@/test/no-scores";
import { LivePaceMeter } from "./LivePaceMeter";

const percent = (el: HTMLElement, prop: "left" | "width") => el.style[prop];

describe("LivePaceMeter", () => {
  it("places the dot inside the usual band", () => {
    render(<LivePaceMeter rate={4.2} usual={[3.8, 4.6]} />);
    const band = screen.getByTestId("usual-band");
    const dot = screen.getByTestId("pace-dot");
    // Scale 2–7 a second: 3.8 → 36%, 4.6 → 52%, 4.2 → 44%.
    expect(percent(band, "left")).toBe("36%");
    expect(percent(band, "width")).toBe("16%");
    expect(percent(dot, "left")).toBe("44%");
    expect(screen.getByText(/about 4.2 syllables a second/)).toBeInTheDocument();
  });

  it("says Listening until a value arrives", () => {
    render(<LivePaceMeter rate={null} usual={null} />);
    expect(screen.getByText("Listening…")).toBeInTheDocument();
    expect(screen.queryByTestId("pace-dot")).not.toBeInTheDocument();
    expect(screen.getByText("Live pace is shown visually; it is an estimate.")).toBeInTheDocument();
  });

  it("uses no colour words or scores", () => {
    const { container } = render(<LivePaceMeter rate={9} usual={[3, 4]} />);
    expect(screen.getByTestId("pace-dot").style.left).toBe("100%");
    const text = container.textContent ?? "";
    expect(offending(text)).toEqual([]);
    expect(text).not.toMatch(/\b(red|green|too fast|too slow|good|bad|target)\b/i);
    expect(container.innerHTML).not.toMatch(/\b(red|green)\b|destructive/);
  });
});
