import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { useLocation } from "react-router";
import { renderWithApp } from "@/test/render";
import { PROMPTS } from "@/content/prompts";
import { showSurprisePrompt } from "./SurprisePrompt";
import { useNavigate } from "react-router";
function Deliver() {
  const navigate = useNavigate();
  return <button onClick={() => showSurprisePrompt("2026-10-19", navigate, () => {})}>Deliver</button>;
}
function Studio() { return <p>Studio {useLocation().search}</p>; }
it("starts the Studio with the surprise prompt", async () => {
  const user = userEvent.setup();
  renderWithApp(<Deliver />, { routes: [{ path: "/practice/ex-repeat", element: <Studio /> }] });
  await user.click(screen.getByText("Deliver"));
  const prompt = PROMPTS.find((p) => screen.queryByText(`Surprise prompt: ${p.text}`));
  expect(prompt).toBeDefined();
  await user.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByText(`Studio ?prompt=${prompt!.id}`)).toBeInTheDocument();
});
