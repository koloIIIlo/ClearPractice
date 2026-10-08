import { useSyncExternalStore } from "react";

/**
 * Connects one take's player with the views drawn under it (P.4): the player
 * publishes its position and offers a seek; views read the position through a
 * subscription so frame-rate time updates re-render only what draws the playhead.
 */
export type PlayerLink = {
  /** Current position, or null while no player is open for this take. */
  getPositionMs: () => number | null;
  subscribe: (listener: () => void) => () => void;
  publish: (ms: number) => void;
  attach: (seek: (ms: number) => void) => () => void;
  seek: (ms: number) => void;
};

export function createPlayerLink(): PlayerLink {
  const listeners = new Set<() => void>();
  let seekFn: ((ms: number) => void) | null = null;
  let position: number | null = null;
  const notify = () => listeners.forEach((l) => l());
  return {
    getPositionMs: () => position,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish: (ms) => {
      if (seekFn === null || ms === position) return;
      position = ms;
      notify();
    },
    attach: (seek) => {
      seekFn = seek;
      position = 0;
      notify();
      return () => {
        if (seekFn !== seek) return;
        seekFn = null;
        position = null;
        notify();
      };
    },
    seek: (ms) => seekFn?.(ms),
  };
}

const noLink = () => () => {};
const nothing = () => null;

export function useLinkedPosition(link?: PlayerLink): number | null {
  return useSyncExternalStore(link?.subscribe ?? noLink, link?.getPositionMs ?? nothing);
}
