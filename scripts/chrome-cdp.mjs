/**
 * Attaching Playwright to the user's debug Chrome (the one `npm run chrono:chrome` starts).
 * Shared by chrono-mcp and punch-mcp.
 *
 * connectOverCDP attaches to EVERY open tab, so a single tab that doesn't answer — a
 * frozen/hung tab or one stuck on a dialog (seen with an idle "New Tab" page) — makes the
 * whole attach time out with an opaque error. So first ping each tab over its own CDP
 * socket and, if one doesn't answer, fail fast naming it. Nothing is closed or changed.
 */
import { chromium } from "playwright-core";

/** Ask one tab to evaluate 1+1; resolves false when it doesn't answer within `ms`. */
function pingTab(wsUrl, ms) {
  return new Promise((resolve) => {
    let ws;
    const done = (ok) => {
      clearTimeout(timer);
      try { ws?.close(); } catch { /* already closed */ }
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), ms);
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      done(false);
      return;
    }
    ws.onerror = () => done(false);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "1+1", returnByValue: true } }));
    ws.onmessage = (m) => {
      try {
        if (JSON.parse(String(m.data)).id === 1) done(true);
      } catch { /* not ours */ }
    };
  });
}

/** Thrown when a tab blocks the attach; the MCP tools pass its message through as-is. */
export class StuckTabError extends Error {}

export async function connectToChrome(cdp, { timeout = 20000 } = {}) {
  let targets = [];
  try {
    const res = await fetch(`${cdp}/json/list`, { signal: AbortSignal.timeout(5000) });
    targets = await res.json();
  } catch {
    // Chrome not reachable — let connectOverCDP report that.
  }
  const tabs = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const answers = await Promise.all(tabs.map((t) => pingTab(t.webSocketDebuggerUrl, 3000)));
  const stuck = tabs.filter((_, i) => !answers[i]);
  if (stuck.length) {
    const names = stuck.map((t) => `“${t.title || t.url}” (${t.url.slice(0, 60)})`).join(", ");
    throw new StuckTabError(
      `A tab in the automation Chrome isn't responding: ${names}. Close ${stuck.length === 1 ? "that tab" : "those tabs"} (or dismiss any dialog open there) and try again.`,
    );
  }
  return chromium.connectOverCDP(cdp, { timeout });
}
