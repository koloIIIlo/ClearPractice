import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { toast } from "sonner";

afterEach(() => {
  cleanup();
  // Sonner keeps its toasts in a module store and replays them to the next Toaster.
  toast.dismiss();
  window.location.hash = "";
  try { window.localStorage.clear(); } catch { /* no storage in this environment */ }
});

// jsdom lacks these browser APIs used by Radix, the sidebar, and Recharts.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
window.scrollTo = () => {};
// Radix Select opens on pointer events that jsdom does not implement.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
