"use client";

import { useEffect, useSyncExternalStore } from "react";

// Which todos you've seen (this browser): { since: first visit, ids: hovered since }. A todo made
// after `since` and not hovered yet is new — highlighted till the mouse passes over it.
const KEY = "zeff-todos-seen";
const EVENT = "zeff-todos-seen";
type Seen = { since: string; ids: number[]; /** When each was seen (ISO): a todo touched since (a duplicate merged into it) is new again. */ at?: Record<string, string> };

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
    return v && typeof v.since === "string" ? { since: v.since, ids: Array.isArray(v.ids) ? v.ids : [], at: v.at && typeof v.at === "object" ? v.at : {} } : null;
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

const ms = (s: string) => Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);

/** Is this todo new to you (made, or touched by a merged duplicate, since you saw it) — and the call that marks it seen. */
export function useTodoNew(id: number, createdAt: string, mergedAt?: string | null): [boolean, () => void] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  useEffect(() => {
    if (readRaw() === "") write({ since: new Date().toISOString(), ids: [] }); // from now on
  }, []);
  const seen = parse(raw);
  const made = ms(createdAt);
  // The last time it changed for you: its making, or the duplicate it took in since.
  const touched = Math.max(made, mergedAt ? ms(mergedAt) : 0);
  // Seen at: the hover that marked it (older marks have no time: they saw it as made).
  const seenAt = seen?.at?.[id] ? ms(seen.at[id]) : seen?.ids.includes(id) ? made : 0;
  const isNew = !!seen && touched > Date.parse(seen.since) && touched > seenAt;
  const markSeen = () => {
    const now = parse(readRaw());
    if (!isNew || !now) return;
    const at: Record<string, string> = { ...now.at, [id]: new Date().toISOString() };
    const keep = Object.keys(at).sort((a, b) => at[a].localeCompare(at[b])).slice(-500);
    write({ since: now.since, ids: [...new Set([...now.ids, id])].slice(-500), at: Object.fromEntries(keep.map((k) => [k, at[k]])) });
  };
  return [isNew, markSeen];
}
