"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { boardDot } from "@/plugins/kanban/colors";
import { BOARD_COLORS } from "@/plugins/kanban/shared";
import { createKeepBoardAction, deleteKeepBoardAction, moveKeepBoardAction, updateKeepBoardAction } from "./actions";

type Row = { id: number; name: string; description: string; color: string; archived: boolean; inLage: boolean; inKnowledge: boolean; notes: number };
type Result = { ok: boolean; error?: string; message?: string; id?: number };

function Colors({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  return (
    <span className="flex items-center gap-1" role="radiogroup" aria-label="Colour">
      {BOARD_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => c !== value && onPick(c)}
          className={`size-4 rounded-full ${boardDot(c)} ring-offset-2 dark:ring-offset-zinc-900 ${value === c ? "ring-2 ring-zinc-500" : "opacity-50 hover:opacity-100"}`}
        />
      ))}
    </span>
  );
}

/** One board: name and description (saved when you leave the field), colour, in the Lage, order, archive, delete. */
function BoardRow({ b, first, last, run }: { b: Row; first: boolean; last: boolean; run: (fn: () => Promise<Result>) => void }) {
  const [name, setName] = useState(b.name);
  const [description, setDescription] = useState(b.description);
  return (
    <li className={`card space-y-3 p-4 ${b.archived ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex flex-col">
          <button type="button" className="icon-btn h-4 text-xs" disabled={first} onClick={() => run(() => moveKeepBoardAction(b.id, -1))} aria-label="Move up" title="Move up">
            ▲
          </button>
          <button type="button" className="icon-btn h-4 text-xs" disabled={last} onClick={() => run(() => moveKeepBoardAction(b.id, 1))} aria-label="Move down" title="Move down">
            ▼
          </button>
        </span>
        <input className="input max-w-xs font-medium" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== b.name && run(() => updateKeepBoardAction(b.id, { name }))} aria-label="Name" />
        <Colors value={b.color} onPick={(color) => run(() => updateKeepBoardAction(b.id, { color }))} />
        <span className="text-xs text-zinc-500">
          {b.notes} notes{b.archived ? " · archived" : ""}
        </span>
        <span className="ml-auto flex gap-2">
          {!b.archived && (
            <Link href={`/keep/${b.id}`} className="btn btn-sm">
              Open
            </Link>
          )}
          <button type="button" className="btn btn-sm" onClick={() => run(() => updateKeepBoardAction(b.id, { archived: !b.archived }))}>
            {b.archived ? "Restore" : "Archive"}
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => confirm(`Delete the board “${b.name}” with all its ${b.notes} notes?`) && run(() => deleteKeepBoardAction(b.id))}>
            Delete
          </button>
        </span>
      </div>
      <input
        className="input text-sm"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => description !== b.description && run(() => updateKeepBoardAction(b.id, { description }))}
        placeholder="Description (optional)"
        aria-label="Description"
      />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={b.inLage} onChange={(e) => run(() => updateKeepBoardAction(b.id, { inLage: e.target.checked }))} className="mt-0.5 size-4 accent-indigo-600" />
        <span>
          In the briefing
          <span className="block text-xs text-zinc-500">The notes are context for the analysis, the note review makes todos from them, note matching attaches them to fitting todos.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={b.inKnowledge} onChange={(e) => run(() => updateKeepBoardAction(b.id, { inKnowledge: e.target.checked }))} className="mt-0.5 size-4 accent-indigo-600" />
        <span>
          In the knowledge
          <span className="block text-xs text-zinc-500">The notes go into the knowledge (Knowledge plugin) — searchable, in the graph, in the chat. A board “Knowledge” is the quickest way to keep something.</span>
        </span>
      </label>
    </li>
  );
}

/** Your Keep boards — the archived ones too — and a new one. */
export function KeepBoardsManager({ boards }: { boards: Row[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [color, setColor] = useState("amber");
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast(r.error ?? "That didn't work.", { tone: "error" });
      else if (r.message && r.message !== "Saved.") toast(r.message, { tone: "ok" });
      router.refresh();
    });
  return (
    <div className="space-y-3">
      {boards.length ? (
        <ul className="space-y-3">
          {boards.map((b, i) => (
            <BoardRow key={`${b.id}:${b.name}:${b.description}`} b={b} first={i === 0} last={i === boards.length - 1} run={run} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">No boards of your own yet.</p>
      )}
      <form
        className="card flex flex-wrap items-end gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await createKeepBoardAction({ name, color });
            if (!r.ok) return void toast(r.error ?? "That didn't work.", { tone: "error" });
            router.push(`/keep/${r.id}`);
          });
        }}
      >
        <label className="block min-w-48 flex-1 text-sm">
          <span className="label">New board</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Private, Ideas, Shopping" required />
        </label>
        <Colors value={color} onPick={setColor} />
        <button type="submit" className="btn btn-primary" disabled={pending || !name.trim()}>
          Create
        </button>
      </form>
    </div>
  );
}
