import { expect, it } from "vitest";
import { DEFAULT_WINDOWS, lightAt } from "./club";

it("computes light thresholds from the time window", () => {
  for (const window of Object.values(DEFAULT_WINDOWS)) {
    if (!window) continue;
    const [min, max] = window;
    expect(lightAt(min * 1000 - 1, min, max)).toBeNull();
    expect(lightAt(min * 1000, min, max)).toBe("green");
    expect(lightAt((min + max) * 500 - 1, min, max)).toBe("green");
    expect(lightAt((min + max) * 500, min, max)).toBe("amber");
    expect(lightAt(max * 1000 - 1, min, max)).toBe("amber");
    expect(lightAt(max * 1000, min, max)).toBe("red");
    expect(lightAt(max * 1000 + 10000, min, max)).toBe("red");
  }
  expect(lightAt(1500, 1, 2)).toBe("amber");
  expect(lightAt(600000, null, null)).toBeNull();
  expect(lightAt(600000, 60, null)).toBeNull();
  expect(lightAt(600000, 120, 60)).toBeNull();
});
