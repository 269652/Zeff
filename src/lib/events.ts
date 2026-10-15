import { EventEmitter } from "node:events";

/**
 * Changes the open pages should see at once — a run started or ended (by Zeff, a worker or an
 * agent through the MCP), a todo ticked off — told to /api/events (server-sent events), which
 * the pages follow and refresh on. One bus for the whole server (route handlers, actions and
 * the MCP endpoint are separate module copies).
 */
export type ChangeTopic = "work" | "todos" | "attention" | "kanban" | "workspace";

const state = globalThis as { __zeffEvents?: EventEmitter };
const bus = (state.__zeffEvents ??= (() => {
  const e = new EventEmitter();
  e.setMaxListeners(200);
  return e;
})());

/** Tell the open pages something changed (the sync host also tells the web server, whose pages they are). */
export function emitChange(topic: ChangeTopic): void {
  bus.emit("change", topic);
  if (process.env.ZEFF_ROLE === "sync") relayToWeb(topic);
}

/** A change the sync host announced: to the pages of this server only (not on to anyone). */
export function emitLocal(topic: ChangeTopic): void {
  bus.emit("change", topic);
}

/** The sync host → the web server (ZEFF_URL): which topic changed. Fire and forget, one call per topic and moment. */
const relaying = new Set<ChangeTopic>();
function relayToWeb(topic: ChangeTopic): void {
  const web = process.env.ZEFF_URL?.replace(/\/+$/, "");
  const token = process.env.ZEFF_SYNC_TOKEN;
  if (!web || !token || relaying.has(topic)) return;
  relaying.add(topic);
  setTimeout(() => {
    relaying.delete(topic);
    fetch(`${web}/api/host-event`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ topic }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined); // the web server is restarting: it asks the host for the state when it is back
  }, 150).unref();
}

/** Follow the changes; returns how to stop. */
export function onChange(fn: (topic: ChangeTopic) => void): () => void {
  bus.on("change", fn);
  return () => bus.off("change", fn);
}
