"use client";

import { useEffect, useSyncExternalStore } from "react";

// Which todos you've seen (this browser): { since: first visit, ids: hovered since }. A todo made
// after `since` and not hovered yet is new — highlighted till the mouse passes over it.
const KEY = "zeff-todos-seen";
const EVENT = "zeff-todos-seen";
type Seen = { since: string; ids: number[] };

function readRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
function parse(raw: string | null): Seen | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Seen;
    return v && typeof v.since === "string" ? { since: v.since, ids: Array.isArray(v.ids) ? v.ids : [] } : null;
  } catch {
    return null;
  }
}
function write(v: Seen) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(EVENT));
}
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

/** Is this todo new to you — and the call that marks it seen. */
export function useTodoNew(id: number, createdAt: string): [boolean, () => void] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  useEffect(() => {
    if (readRaw() === "") write({ since: new Date().toISOString(), ids: [] }); // from now on
  }, []);
  const seen = parse(raw);
  const made = Date.parse(createdAt.includes("T") ? createdAt : `${createdAt.replace(" ", "T")}Z`);
  const isNew = !!seen && made > Date.parse(seen.since) && !seen.ids.includes(id);
  const markSeen = () => {
    const now = parse(readRaw());
    if (!isNew || !now) return;
    write({ since: now.since, ids: [...now.ids, id].slice(-500) });
  };
  return [isNew, markSeen];
}
