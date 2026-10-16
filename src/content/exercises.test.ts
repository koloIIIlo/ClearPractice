import { expect, it } from "vitest";
import { ExerciseDefinition, ExerciseType } from "@/lib/ipc/schemas";
import { CORE_EXERCISE_TYPES, EXERCISE_IDS, EXERCISE_TYPE_INFO, EXERCISES, exerciseFor } from "./exercises";

it("has the four exercise types once each with unique ids", () => {
  expect(EXERCISES.map((e) => e.type).sort()).toEqual([...CORE_EXERCISE_TYPES].sort());
  expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
  for (const exercise of EXERCISES) {
    expect(() => ExerciseDefinition.parse(exercise), exercise.id).not.toThrow();
    expect(exerciseFor(exercise.type)).toBe(exercise);
  }
});

it("keeps the ids stored in sessions", () => {
  expect(EXERCISE_IDS).toEqual({ repeat: "ex-repeat", thoughtGroups: "ex-thought-groups", imitate: "ex-imitate", expression: "ex-expression" });
  expect(Object.values(EXERCISE_IDS).sort()).toEqual(EXERCISES.map((e) => e.id).sort());
});

it("labels every exercise type and gives each its own icon", () => {
  expect(Object.keys(EXERCISE_TYPE_INFO).sort()).toEqual([...ExerciseType.options].sort());
  const icons = Object.values(EXERCISE_TYPE_INFO).map((i) => i.icon);
  expect(new Set(icons).size).toBe(icons.length);
  for (const info of Object.values(EXERCISE_TYPE_INFO)) expect(info.label.trim().length).toBeGreaterThan(3);
});
