"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { deleteBoardAction, moveBoardAction, updateBoardAction } from "./actions";
import { boardDot } from "./colors";
import { BOARD_COLORS } from "./shared";

type Row = { id: number; name: string; description: string; color: string; archived: boolean; inLage: boolean; cards: number; open: number };
type Result = { ok: boolean; error?: string; message?: string };

/** One board's row: name and description (saved when you leave the field), colour, Lage, order, archive, delete. */
function BoardRow({ b, first, last, run }: { b: Row; first: boolean; last: boolean; run: (fn: () => Promise<Result>) => void }) {
  const [name, setName] = useState(b.name);
  const [description, setDescription] = useState(b.description);
  return (
    <li className={`card space-y-3 p-4 ${b.archived ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex flex-col">
          <button type="button" className="icon-btn h-4 text-xs" disabled={first} onClick={() => run(() => moveBoardAction(b.id, -1))} aria-label="Move up" title="Move up">
            ▲
          </button>
          <button type="button" className="icon-btn h-4 text-xs" disabled={last} onClick={() => run(() => moveBoardAction(b.id, 1))} aria-label="Move down" title="Move down">
            ▼
          </button>
        </span>
        <input
          className="input max-w-xs font-medium"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== b.name && run(() => updateBoardAction(b.id, { name }))}
          aria-label="Name"
        />
        <span className="flex items-center gap-1" role="radiogroup" aria-label="Colour">
          {BOARD_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={b.color === c}
              aria-label={c}
              onClick={() => c !== b.color && run(() => updateBoardAction(b.id, { color: c }))}
              className={`size-4 rounded-full ${boardDot(c)} ring-offset-2 dark:ring-offset-zinc-900 ${b.color === c ? "ring-2 ring-zinc-500" : "opacity-50 hover:opacity-100"}`}
            />
          ))}
        </span>
        <span className="text-xs text-zinc-500">
          {b.open} open · {b.cards} cards{b.archived ? " · archived" : ""}
        </span>
        <span className="ml-auto flex gap-2">
          {!b.archived && (
            <Link href={`/kanban/${b.id}`} className="btn btn-sm">
              Open
            </Link>
          )}
          <button type="button" className="btn btn-sm" onClick={() => run(() => updateBoardAction(b.id, { archived: !b.archived }))}>
            {b.archived ? "Restore" : "Archive"}
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => confirm(`Delete the board “${b.name}” with all its ${b.cards} cards?`) && run(() => deleteBoardAction(b.id))}>
            Delete
          </button>
        </span>
      </div>
      <input
        className="input text-sm"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => description !== b.description && run(() => updateBoardAction(b.id, { description }))}
        placeholder="Description (optional)"
        aria-label="Description"
      />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={b.inLage} onChange={(e) => run(() => updateBoardAction(b.id, { inLage: e.target.checked }))} className="mt-0.5 size-4 accent-indigo-600" />
        <span>
          In the briefing
          <span className="block text-xs text-zinc-500">The open cards go into every briefing run as KB-…: todos for them, a briefing per card, a place in the reports — like Jira tickets.</span>
        </span>
      </label>
    </li>
  );
}

/** All your boards — the archived ones too — to rename, colour, order, put in the Lage, archive or delete. */
export function BoardsManager({ boards }: { boards: Row[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast(r.error ?? "That didn't work.", { tone: "error" });
      else if (r.message && r.message !== "Saved.") toast(r.message, { tone: "ok" });
      router.refresh();
    });
  if (!boards.length) return <p className="text-sm text-zinc-500">No boards yet.</p>;
  return (
    <ul className="space-y-3">
      {boards.map((b, i) => (
        <BoardRow key={`${b.id}:${b.name}:${b.description}`} b={b} first={i === 0} last={i === boards.length - 1} run={run} />
      ))}
    </ul>
  );
}
