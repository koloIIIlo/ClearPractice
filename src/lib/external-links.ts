/**
 * External links open in the system browser, never inside the app window
 * (plan 6.1). Only https links leave the app; anything else is ignored.
 */
export function externalUrl(target: EventTarget | null, base: string): string | null {
  const anchor = target instanceof Element ? target.closest("a[href]") : null;
  if (!anchor) return null;
  let url: URL;
  try {
    url = new URL(anchor.getAttribute("href") ?? "", base);
  } catch {
    return null;
  }
  if (url.origin === new URL(base).origin) return null;
  return url.protocol === "https:" ? url.href : "";
}

/** Installs the handler; `open` hands the URL to the system browser. */
export function routeExternalLinks(open: (url: string) => Promise<void>, doc: Document = document): () => void {
  const onClick = (event: MouseEvent) => {
    const url = externalUrl(event.target, doc.location.href);
    if (url === null) return;
    event.preventDefault();
    if (url) void open(url).catch(() => {});
  };
  doc.addEventListener("click", onClick);
  return () => doc.removeEventListener("click", onClick);
}
