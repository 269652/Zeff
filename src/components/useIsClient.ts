import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** False while rendering on the server (and hydrating), true in the browser after — without an effect. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
