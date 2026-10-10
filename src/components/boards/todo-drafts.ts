"use client";

import { useSyncExternalStore } from "react";

// What you typed into a todo's note or instruction field and haven't sent yet — kept in this
// browser across reloads: { "<todoId>:note" | "<todoId>:ai": text }.
const KEY = "zeff-todo-drafts";
const EVENT = "zeff-todo-drafts";
export type DraftKind = "note" | "ai";

function readRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
function parse(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

/** Keep (or, empty, drop) a draft. */
export function saveDraft(todoId: number, kind: DraftKind, text: string) {
  const all = parse(readRaw());
  const k = `${todoId}:${kind}`;
  if (text.trim()) all[k] = text;
  else delete all[k];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(EVENT));
}

/** A todo's drafts (what's typed and not sent), as they're kept. */
export function useTodoDrafts(todoId: number): Record<DraftKind, string> {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "");
  const all = parse(raw);
  return { note: all[`${todoId}:note`] ?? "", ai: all[`${todoId}:ai`] ?? "" };
}
