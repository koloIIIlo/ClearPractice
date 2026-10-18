import { expect, it } from "vitest";
import { diffWords } from "./diff";

it("marks additions and deletions at word level", () => {
  expect(diffWords("I want be more clear", "I want to be clearer")).toEqual([
    { op: "same", text: "I want" },
    { op: "add", text: "to" },
    { op: "same", text: "be" },
    { op: "del", text: "more clear" },
    { op: "add", text: "clearer" },
  ]);
  expect(diffWords("", "New words")).toEqual([{ op: "add", text: "New words" }]);
  expect(diffWords("Same text.", "same text")).toEqual([{ op: "same", text: "same text" }]);
});

it("keeps punctuation in the display", () => {
  const parts = diffWords("So, um, the index makes the searching more fast.", "So the index makes searching faster.");
  expect(parts).toContainEqual({ op: "del", text: "um," });
  expect(parts[0]).toEqual({ op: "same", text: "So" });
  expect(parts[parts.length - 1]).toEqual({ op: "add", text: "faster." });
  // Read without the deletions, it is exactly the new text.
  expect(parts.filter((p) => p.op !== "del").map((p) => p.text).join(" ")).toBe("So the index makes searching faster.");
});
