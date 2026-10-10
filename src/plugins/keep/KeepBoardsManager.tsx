"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { boardDot } from "@/plugins/kanban/colors";
import { BOARD_COLORS } from "@/plugins/kanban/shared";
import { createKeepBoardAction, deleteKeepBoardAction, moveKeepBoardAction, updateKeepBoardAction } from "./actions";

type Row = { id: number; name: string; description: string; color: string; archived: boolean; inLage: boolean; notes: number };
type Result = { ok: boolean; error?: string; message?: string; id?: number };

function Colors({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  return (
    <span className="flex items-center gap-1" role="radiogroup" aria-label="Farbe">
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
          <button type="button" className="icon-btn h-4 text-xs" disabled={first} onClick={() => run(() => moveKeepBoardAction(b.id, -1))} aria-label="Nach oben" title="Nach oben">
            ▲
          </button>
          <button type="button" className="icon-btn h-4 text-xs" disabled={last} onClick={() => run(() => moveKeepBoardAction(b.id, 1))} aria-label="Nach unten" title="Nach unten">
            ▼
          </button>
        </span>
        <input className="input max-w-xs font-medium" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== b.name && run(() => updateKeepBoardAction(b.id, { name }))} aria-label="Name" />
        <Colors value={b.color} onPick={(color) => run(() => updateKeepBoardAction(b.id, { color }))} />
        <span className="text-xs text-zinc-500">
          {b.notes} Notizen{b.archived ? " · archiviert" : ""}
        </span>
        <span className="ml-auto flex gap-2">
          {!b.archived && (
            <Link href={`/keep/${b.id}`} className="btn btn-sm">
              Öffnen
            </Link>
          )}
          <button type="button" className="btn btn-sm" onClick={() => run(() => updateKeepBoardAction(b.id, { archived: !b.archived }))}>
            {b.archived ? "Zurückholen" : "Archivieren"}
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => confirm(`Board „${b.name}“ mit allen ${b.notes} Notizen löschen?`) && run(() => deleteKeepBoardAction(b.id))}>
            Löschen
          </button>
        </span>
      </div>
      <input
        className="input text-sm"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => description !== b.description && run(() => updateKeepBoardAction(b.id, { description }))}
        placeholder="Beschreibung (optional)"
        aria-label="Beschreibung"
      />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={b.inLage} onChange={(e) => run(() => updateKeepBoardAction(b.id, { inLage: e.target.checked }))} className="mt-0.5 size-4 accent-indigo-600" />
        <span>
          In der Ticket-Lage
          <span className="block text-xs text-zinc-500">Die Notizen sind Kontext der Auswertung, die Notiz-Durchsicht macht Todos aus ihnen, die Notiz-Zuordnung hängt sie an passende Todos.</span>
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
      if (!r.ok) toast(r.error ?? "Ging nicht.", { tone: "error" });
      else if (r.message && r.message !== "Gespeichert.") toast(r.message, { tone: "ok" });
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
        <p className="text-sm text-zinc-500">Noch keine eigenen Boards.</p>
      )}
      <form
        className="card flex flex-wrap items-end gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await createKeepBoardAction({ name, color });
            if (!r.ok) return void toast(r.error ?? "Ging nicht.", { tone: "error" });
            router.push(`/keep/${r.id}`);
          });
        }}
      >
        <label className="block min-w-48 flex-1 text-sm">
          <span className="label">Neues Board</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Privat, Ideen, Einkauf" required />
        </label>
        <Colors value={color} onPick={setColor} />
        <button type="submit" className="btn btn-primary" disabled={pending || !name.trim()}>
          Anlegen
        </button>
      </form>
    </div>
  );
}
