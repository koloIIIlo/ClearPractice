import { expect, it, vi } from "vitest";
import { externalUrl, routeExternalLinks } from "./external-links";

it("sends https links outside the app to the system browser and blocks other schemes (6.1)", () => {
  document.body.innerHTML = `<a id="ext" href="https://github.com/yt-dlp/yt-dlp"><span id="inner">x</span></a><a id="local" href="#/settings">s</a><a id="http" href="http://example.com">h</a><a id="file" href="file:///C:/x">f</a>`;
  const open = vi.fn(async () => {});
  const stop = routeExternalLinks(open);
  const click = (id: string) => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.getElementById(id)!.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(click("inner")).toBe(true);
  expect(open).toHaveBeenCalledWith("https://github.com/yt-dlp/yt-dlp");
  expect(click("local")).toBe(false);
  expect(click("http")).toBe(true);
  expect(click("file")).toBe(true);
  expect(open).toHaveBeenCalledTimes(1);
  stop();
  expect(externalUrl(null, "http://localhost:1420/")).toBeNull();
});
