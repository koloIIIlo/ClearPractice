import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { createMockClient } from "@/lib/ipc/mock-client";
import type { IpcClient } from "@/lib/ipc";
import { factsBuilder } from "@/test/fixtures/facts";
import { expectNoScores } from "@/test/no-scores";
import { renderWithApp } from "@/test/render";
import { SpeechProfile } from "./SpeechProfile";

it("renders every row with a label and no score words", async () => {
  let b = factsBuilder("2026-10-30");
  for (let i = 0; i < 6; i += 1) b = b.onDay(70 - i).session({ familiarity: i % 2 ? "unfamiliar" : "familiar" }).take({ transcribed: true, paceWpm: 112, meanRun: 5.1, differentPer50: 33, rateSps: 3.9, watchPer100: 2, hedgesPer100: 3 });
  for (let i = 0; i < 6; i += 1) b = b.onDay(6 - i).session().take({ transcribed: true, paceWpm: 124, meanRun: 7.4, differentPer50: 37, rateSps: 4.2, watchPer100: 1.5, hedgesPer100: 3, phraseIds: i === 0 ? ["phrase-9"] : [] });
  const client: IpcClient = { ...createMockClient(), getPracticeFacts: async () => b.build() };
  renderWithApp(<SpeechProfile />, { client });
  expect(await screen.findByRole("heading", { name: "Your speech profile" })).toBeInTheDocument();
  for (const label of ["Typical pace", "Typical run", "Pitch range", "Speech rate (audio)", "Words you use often", "Hedges", "Saved phrases used"]) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
  expect(screen.getByText("Saved phrases used").nextSibling).toHaveTextContent("1 in the last 30 days");
  expect(screen.getByText(/Unavailable: No take has an intonation track yet/)).toBeInTheDocument();
  expect(screen.getByText("Mean run").nextSibling).toHaveTextContent("5.1 → 7.4 words");
  expect(screen.getAllByText("Estimated").length).toBeGreaterThanOrEqual(7);
  expectNoScores();
});

it("says how the profile starts before the first take", async () => {
  const client: IpcClient = { ...createMockClient(), getPracticeFacts: async () => factsBuilder().build() };
  renderWithApp(<SpeechProfile />, { client });
  expect(await screen.findByText("Your profile starts with your first take")).toBeInTheDocument();
});
