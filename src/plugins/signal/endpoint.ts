import { execFile } from "node:child_process";
import { cdpEndpoint } from "../../../scripts/cdp-endpoint.mjs";
import { cdpUp } from "@/plugins/drivers";

/**
 * Signal Desktop as the Signal plugin reaches it (server only): over its debug port — Signal started
 * with --remote-debugging-port (the driver starts it so; the autostart can too, see autostart.ts).
 * Local only (127.0.0.1). SIGNAL_CDP_ENDPOINT overrides it.
 */
export const SIGNAL_PORT = 9339;
export const signalCdp = () => (process.env.SIGNAL_CDP_ENDPOINT || cdpEndpoint(SIGNAL_PORT)).replace(/\/$/, "");

/** Whether Signal answers on its debug port. */
export const signalUp = (): Promise<boolean> =>
  cdpUp(signalCdp(), 2500);

/** Whether Signal Desktop runs at all (with the port or without). */
export const signalRunning = (): Promise<boolean> =>
  process.platform !== "win32"
    ? Promise.resolve(false)
    : new Promise((resolve) => execFile("tasklist", ["/FI", "IMAGENAME eq Signal.exe", "/NH"], { windowsHide: true, timeout: 10000 }, (_e, out) => resolve(/Signal\.exe/i.test(String(out ?? "")))));
