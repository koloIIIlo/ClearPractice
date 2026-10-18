import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PRESSURE_LEVELS, pressureDef } from "./pressure";
import { PressureDial } from "./PressureDial";

it("describes each level", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<PressureDial value={1} onChange={onChange} />);
  expect(screen.getAllByRole("radio")).toHaveLength(4);
  for (const p of PRESSURE_LEVELS) {
    const radio = screen.getByRole("radio", { name: new RegExp(`${p.level} · ${p.name}`) });
    expect(radio).toHaveAccessibleDescription(p.description);
    expect(screen.getByText(p.description)).toBeVisible();
  }
  expect(screen.getByRole("radio", { name: /1 · Real/ })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: /3 · High stakes/ }));
  expect(onChange).toHaveBeenCalledWith(3);
  // The limits the recorder applies (13.5).
  expect(PRESSURE_LEVELS.map((p) => [p.limitSeconds, p.chimeSeconds, p.interrupts])).toEqual([[null, null, false], [90, null, false], [60, null, true], [45, 40, true]]);
  expect(pressureDef(7).name).toBe("High stakes");
});
