import { EventEmitter } from "node:events";

/**
 * Changes the open pages should see at once — a run started or ended (by Zeff, a worker or an
 * agent through the MCP), a todo ticked off — told to /api/events (server-sent events), which
 * the pages follow and refresh on. One bus for the whole server (route handlers, actions and
 * the MCP endpoint are separate module copies).
 */
export type ChangeTopic = "work" | "todos" | "attention" | "branches";

const state = globalThis as { __zeffEvents?: EventEmitter };
const bus = (state.__zeffEvents ??= (() => {
  const e = new EventEmitter();
  e.setMaxListeners(200);
  return e;
})());

/** Tell the open pages something changed. */
export function emitChange(topic: ChangeTopic): void {
  bus.emit("change", topic);
}

/** Follow the changes; returns how to stop. */
export function onChange(fn: (topic: ChangeTopic) => void): () => void {
  bus.on("change", fn);
  return () => bus.off("change", fn);
}
