import { expect, it } from "vitest";
import { stepZoom } from "./zoom";

it("zooms in steps between 80 % and 200 %, and Ctrl 0 returns to 100 %", () => {
  expect(stepZoom(1, 1)).toBe(1.1);
  expect(stepZoom(1, -1)).toBe(0.9);
  expect(stepZoom(2, 1)).toBe(2);
  expect(stepZoom(0.8, -1)).toBe(0.8);
  expect(stepZoom(1.5, 0)).toBe(1);
  expect(stepZoom(1.33, 1)).toBe(1.1); // an unknown level starts from 100 %
});
