"use client";

import { useState, type ReactNode } from "react";
import type { ActionState } from "@/app/action-helpers";
import { ContextForm, type ContextFormDefaults } from "./ContextForm";

/**
 * Under an entry's context: "+ Write a note" and "Link existing…", each opening its form below
 * (one at a time; a saved note closes it). Closed forms keep what was typed.
 */
export function EntryContextAdders({
  noteAction,
  noteDefaults,
  link,
}: {
  noteAction: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  /** The entry's ticket and date. */
  noteDefaults: ContextFormDefaults;
  /** The "link an item that's already in Zeff" form — none when there's nothing to link. */
  link?: ReactNode;
}) {
  const [open, setOpen] = useState<"note" | "link" | null>(null);
  const toggle = (what: "note" | "link") => setOpen((o) => (o === what ? null : what));
  const tab = (what: "note" | "link", label: string) => (
    <button
      type="button"
      className={`btn btn-sm ${open === what ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
      aria-expanded={open === what}
      onClick={() => toggle(what)}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tab("note", "+ Write a note")}
        {link && tab("link", "Link existing…")}
      </div>
      <div hidden={open !== "note"} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <ContextForm action={noteAction} defaults={noteDefaults} fromEntry sources={false} submitLabel="Add note" onDone={() => setOpen(null)} />
      </div>
      {link && (
        <div hidden={open !== "link"} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          {link}
        </div>
      )}
    </div>
  );
}
