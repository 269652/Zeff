"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { CloseIcon, PencilIcon } from "@/components/icons";
import {
  addColumnAction,
  archiveCardAction,
  createCardAction,
  deleteCardAction,
  deleteColumnAction,
  moveCardAction,
  moveColumnAction,
  updateBoardAction,
  updateCardAction,
  updateColumnAction,
} from "./actions";
import { BoardFrame, COLUMN } from "./BoardFrame";
import { CardChecklist } from "./CardChecklist";
import { initials, NOBODY, PersonChips, peopleOf } from "./PersonChips";
import { PRIORITIES, PRIORITY_LABELS, type BoardView, type CardLage, type CardView, type ColumnView, type Priority } from "./shared";
import { isoDate } from "@/lib/week";

type Result = { ok: boolean; error?: string; message?: string; id?: number };

const PRIORITY_TONE: Record<Priority, string> = {
  low: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  normal: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  high: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  urgent: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

const today = () => isoDate(new Date()); // the local day, not UTC's
const dueTone = (due: string) => (due < today() ? "text-red-600 dark:text-red-400" : due === today() ? "text-amber-700 dark:text-amber-400" : "text-zinc-500");
const fmtDue = (due: string) => new Date(`${due}T00:00:00`).toLocaleDateString("de-DE", { day: "numeric", month: "short" });

/** The Lage's attention as a stripe colour. */
const STRIPE: Record<string, string> = {
  feedback: "border-l-red-500",
  blocked: "border-l-amber-500",
  active: "border-l-indigo-500",
  check: "border-l-sky-500",
  spec: "border-l-violet-500",
  ready: "border-l-emerald-500",
  stale: "border-l-zinc-400",
};

/**
 * A card in a column: its ref, title, person, labels, priority and due day — and, when the
 * Lage has read it, its attention (the stripe), headline and open todos. Dragged to move it,
 * clicked to open it.
 */
function Card({ c, lage, onOpen, onDragStart, onDragEnd, dragging }: { c: CardView; lage?: CardLage; onOpen: () => void; onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void; dragging: boolean }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      data-card-id={c.id}
      className={`group w-full cursor-grab rounded-lg border border-l-4 border-zinc-200 bg-white p-2.5 text-left text-sm shadow-xs transition hover:border-indigo-300 hover:shadow-sm active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-indigo-700 ${lage?.attention ? (STRIPE[lage.attention] ?? "") : "border-l-zinc-200 dark:border-l-zinc-700"} ${dragging ? "opacity-40" : ""}`}
    >
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1 font-medium break-words">{c.title}</span>
        <span className="shrink-0 font-mono text-[11px] text-zinc-400">{c.ref}</span>
        {c.assignee && (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[9px] font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" title={c.assignee}>
            {initials(c.assignee)}
          </span>
        )}
      </span>
      {lage?.lead && <span className="mt-1 block text-xs text-zinc-600 dark:text-zinc-400">{lage.lead}</span>}
      {(c.labels.length > 0 || c.priority || c.due || c.description) && (
        <span className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
          {c.priority && c.priority !== "normal" && <span className={`rounded px-1.5 py-0.5 font-medium ${PRIORITY_TONE[c.priority]}`}>{PRIORITY_LABELS[c.priority]}</span>}
          {c.labels.map((l) => (
            <span key={l} className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
              {l}
            </span>
          ))}
          {c.due && <span className={`ml-auto ${dueTone(c.due)}`}>⏰ {fmtDue(c.due)}</span>}
          {c.description && !c.due && <span className="ml-auto text-zinc-400" title="Hat eine Beschreibung">≡</span>}
        </span>
      )}
      {lage && lage.todos.length > 0 && (() => {
        // The checklist's progress: done of all (open ones first in the card's panel).
        const done = lage.todos.filter((t) => t.status === "done").length;
        const all = lage.todos.length;
        return (
          <span
            className={`mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${done === all ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"}`}
            title={`${all - done} offen, ${done} erledigt`}
          >
            ☑ {done}/{all}
          </span>
        );
      })()}
    </button>
  );
}

/** A card opened: everything about it, to change — and to move, archive or delete it. */
function CardPanel({ c, lage, people, columns, onClose, run }: { c: CardView; lage?: CardLage; people: string[]; columns: ColumnView[]; onClose: () => void; run: (fn: () => Promise<Result>, after?: () => void) => void }) {
  const [title, setTitle] = useState(c.title);
  const [description, setDescription] = useState(c.description);
  const [labels, setLabels] = useState(c.labels.join(", "));
  const [priority, setPriority] = useState<string>(c.priority ?? "");
  const [due, setDue] = useState(c.due ?? "");
  const [assignee, setAssignee] = useState(c.assignee ?? "");
  const dirty = title !== c.title || description !== c.description || labels !== c.labels.join(", ") || priority !== (c.priority ?? "") || due !== (c.due ?? "") || assignee !== (c.assignee ?? "");
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  const save = () =>
    run(() =>
      updateCardAction(c.id, {
        title,
        description,
        labels: labels
          .split(",")
          .map((l) => l.trim())
          .filter(Boolean),
        priority: priority || null,
        due: due || null,
        assignee: assignee || null,
      }),
    );
  return (
    <>
      <div className="fixed inset-0 z-40 bg-zinc-950/30" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-label={`Karte ${c.ref}`} className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <span className="font-mono text-sm text-zinc-500">{c.ref}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen" title="Schließen (Esc)">
            <CloseIcon />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <label className="block">
            <span className="label">Titel</span>
            <input className="input text-base font-medium" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Beschreibung</span>
            <textarea className="input min-h-40 font-mono text-xs" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Worum es geht, Schritte, Links …" />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="label">Spalte</span>
              <select className="input" value={c.columnId} onChange={(e) => run(() => moveCardAction(c.id, Number(e.target.value), null))}>
                {columns.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Priorität</span>
              <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="">—</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Fällig</span>
              <input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="label">Person</span>
            <input className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)} list="kanban-people" placeholder="Wer dran ist (optional)" />
            <datalist id="kanban-people">
              {people.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="label">Labels (durch Komma)</span>
            <input className="input" value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="z. B. privat, Steuer, Garten" />
          </label>
          <CardChecklist cardRef={c.ref} todos={lage?.todos ?? []} />
          {lage && (lage.lead || lage.summary || lage.happened.length > 0) && (
            <section className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/50 p-3 text-sm dark:border-violet-900 dark:bg-violet-950/30">
              <h3 className="label">
                Lage{lage.attentionLabel ? ` · ${lage.attentionLabel}` : ""}
              </h3>
              {lage.lead && <p className="font-medium">{lage.lead}</p>}
              {lage.summary && <p className="whitespace-pre-line text-zinc-700 dark:text-zinc-300">{lage.summary}</p>}
              {lage.happened.length > 0 && (
                <ol className="space-y-0.5 text-xs">
                  {lage.happened.map((h, i) => (
                    <li key={i}>
                      <span className="text-zinc-500">
                        {h.when}
                        {h.who ? ` · ${h.who}` : ""}:
                      </span>{" "}
                      {h.what}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
          <p className="text-xs text-zinc-500">
            Angelegt {new Date(c.createdAt.replace(" ", "T") + (c.createdAt.includes("Z") ? "" : "Z")).toLocaleString("de-DE")}
            {c.doneAt && ` · erledigt ${new Date(c.doneAt).toLocaleString("de-DE")}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <button type="button" className="btn btn-primary" disabled={!dirty || !title.trim()} onClick={save}>
            Speichern
          </button>
          <button type="button" className="btn" onClick={() => run(() => archiveCardAction(c.id), onClose)}>
            Archivieren
          </button>
          <button
            type="button"
            className="btn btn-danger ml-auto"
            onClick={() => {
              if (confirm(`${c.ref} „${c.title}“ löschen?`)) run(() => deleteCardAction(c.id), onClose);
            }}
          >
            Löschen
          </button>
        </div>
      </aside>
    </>
  );
}

/** A column's head: its name (click to rename), how many (of the WIP limit), and its menu. */
function ColumnHead({ col, first, last, run }: { col: ColumnView; first: boolean; last: boolean; run: (fn: () => Promise<Result>) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(col.name);
  const [menu, setMenu] = useState(false);
  const over = col.wipLimit !== null && col.cards.length > col.wipLimit;
  return (
    <div className="relative flex items-center gap-1.5 px-1">
      {editing ? (
        <form
          className="flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setEditing(false);
            if (name.trim() && name !== col.name) run(() => updateColumnAction(col.id, { name }));
          }}
        >
          <input className="input py-0.5 text-sm font-semibold" value={name} autoFocus onChange={(e) => setName(e.target.value)} onBlur={(e) => e.currentTarget.form?.requestSubmit()} />
        </form>
      ) : (
        <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-semibold" onClick={() => setEditing(true)} title="Umbenennen">
          {col.name}
          {col.done && <span className="ml-1 text-xs font-normal text-emerald-600 dark:text-emerald-400">✓</span>}
        </button>
      )}
      <span className={`rounded-full px-1.5 text-xs tabular-nums ${over ? "bg-red-100 font-semibold text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-zinc-200/70 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`} title={col.wipLimit ? `WIP-Limit ${col.wipLimit}` : undefined}>
        {col.cards.length}
        {col.wipLimit ? `/${col.wipLimit}` : ""}
      </span>
      <button type="button" className="icon-btn" onClick={() => setMenu(!menu)} aria-label="Spalten-Menü" title="Spalte …">
        <PencilIcon className="size-3.5" />
      </button>
      {menu && (
        <div className="absolute top-full right-0 z-20 mt-1 w-56 space-y-1 rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900" onMouseLeave={() => setMenu(false)}>
          {[
            ["← nach links", () => moveColumnAction(col.id, -1), first],
            ["nach rechts →", () => moveColumnAction(col.id, 1), last],
          ].map(([label, fn, off]) => (
            <button key={label as string} type="button" disabled={off as boolean} className="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800" onClick={() => run(fn as () => Promise<Result>)}>
              {label as string}
            </button>
          ))}
          <button type="button" className="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => run(() => updateColumnAction(col.id, { done: !col.done }))}>
            {col.done ? "Zählt nicht mehr als erledigt" : "Zählt als erledigt ✓"}
          </button>
          <button
            type="button"
            className="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => {
              const v = prompt("WIP-Limit (leer: keins)", col.wipLimit ? String(col.wipLimit) : "");
              if (v !== null) run(() => updateColumnAction(col.id, { wipLimit: v.trim() ? Number(v) : null }));
            }}
          >
            WIP-Limit …
          </button>
          <button type="button" className="block w-full rounded px-2 py-1 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950" onClick={() => confirm(`Spalte „${col.name}“ löschen?`) && run(() => deleteColumnAction(col.id))}>
            Spalte löschen
          </button>
        </div>
      )}
    </div>
  );
}

/** A new card at a column's end: typed in, Enter — the next one right after. */
function AddCard({ columnId, run }: { columnId: number; run: (fn: () => Promise<Result>) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  if (!open)
    return (
      <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-sm text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800" onClick={() => setOpen(true)}>
        + Karte
      </button>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        const t = title;
        setTitle("");
        run(() => createCardAction(columnId, t));
      }}
    >
      <textarea
        className="input min-h-16 text-sm"
        value={title}
        autoFocus
        placeholder="Titel — Enter zum Anlegen, Esc zum Schließen"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          } else if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => !title.trim() && setOpen(false)}
      />
    </form>
  );
}

/**
 * Your own board: its columns side by side, the cards in them — dragged between and within
 * columns, opened to change. Columns are renamed, moved, limited (WIP), marked as "done" here.
 */
export function OwnBoard({ board, lage = {} }: { board: BoardView; lage?: Record<string, CardLage> }) {
  const router = useRouter();
  const params = useSearchParams();
  const [cols, setCols] = useState(board.columns);
  const [shownFor, setShownFor] = useState(board);
  // A link to a card (?card=12 — from a todo, the Lage, a hover card): opened.
  const [open, setOpen] = useState<number | null>(() => (Number(params.get("card")) || null));
  const [persons, setPersons] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<number | null>(null);
  const [drop, setDrop] = useState<{ col: number; before: number | null } | null>(null);
  const [filter, setFilter] = useState("");
  const [, start] = useTransition();
  const [newCol, setNewCol] = useState("");
  const [editingName, setEditingName] = useState(false);
  const bodies = useRef(new Map<number, HTMLDivElement>());

  // The board as the server has it now (after a change, a refresh) — what's shown follows.
  if (shownFor !== board) {
    setShownFor(board);
    setCols(board.columns);
  }

  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast(r.error ?? "Ging nicht.", { tone: "error" });
      else {
        if (r.message) toast(r.message, { tone: "ok" });
        after?.();
      }
      router.refresh();
    });

  const where = (e: React.DragEvent, colId: number) => {
    const body = bodies.current.get(colId);
    const items = body ? [...body.querySelectorAll<HTMLElement>("[data-card-id]")] : [];
    const at = items.find((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    return { col: colId, before: at ? Number(at.dataset.cardId) : null };
  };

  const onDrop = (colId: number) => {
    if (drag === null || !drop) return;
    const id = drag;
    const before = drop.before === id ? null : drop.before;
    // At once here; then on the server.
    setCols((cs) => {
      const card = cs.flatMap((c) => c.cards).find((c) => c.id === id);
      if (!card) return cs;
      return cs.map((c) => {
        const rest = c.cards.filter((x) => x.id !== id);
        if (c.id !== colId) return { ...c, cards: rest };
        const i = before === null ? rest.length : Math.max(0, rest.findIndex((x) => x.id === before));
        return { ...c, cards: [...rest.slice(0, i), { ...card, columnId: colId }, ...rest.slice(i)] };
      });
    });
    setDrag(null);
    setDrop(null);
    run(() => moveCardAction(id, colId, before));
  };

  const q = filter.trim().toLowerCase();
  const matches = (c: CardView) =>
    (!q || `${c.ref} ${c.title} ${c.description} ${c.labels.join(" ")} ${c.assignee ?? ""}`.toLowerCase().includes(q)) && (!persons.size || persons.has(c.assignee || NOBODY));
  const allCards = cols.flatMap((c) => c.cards);
  const people = peopleOf(allCards.map((c) => c.assignee));
  const opened = open !== null ? cols.flatMap((c) => c.cards).find((c) => c.id === open) : undefined;

  return (
    <>
      <BoardFrame
        sidebar={
          <>
            <div>
              {editingName ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = new FormData(e.currentTarget).get("name");
                    setEditingName(false);
                    if (name && name !== board.name) run(() => updateBoardAction(board.id, { name: String(name) }));
                  }}
                >
                  <input name="name" className="input text-lg font-semibold" defaultValue={board.name} autoFocus onBlur={(e) => e.currentTarget.form?.requestSubmit()} />
                </form>
              ) : (
                <h1 className="cursor-text text-lg font-semibold" onClick={() => setEditingName(true)} title="Umbenennen">
                  {board.name}
                </h1>
              )}
              {board.description && <p className="mt-1 text-sm text-zinc-500">{board.description}</p>}
              <p className="mt-1 text-xs text-zinc-500">
                {allCards.length} Karten · {board.inLage ? "in der Ticket-Lage (KB-…)" : "nicht in der Ticket-Lage"}
              </p>
            </div>
            <input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Karten filtern …" aria-label="Karten filtern" />
            {people.length > 0 && (
              <div className="space-y-1.5">
                <h2 className="label">Personen</h2>
                <PersonChips
                  people={people}
                  selected={persons}
                  onToggle={(n) =>
                    setPersons((s) => {
                      const next = new Set(s);
                      if (next.has(n)) next.delete(n);
                      else next.add(n);
                      return next;
                    })
                  }
                  onClear={() => setPersons(new Set())}
                />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  const d = prompt("Beschreibung des Boards", board.description);
                  if (d !== null) run(() => updateBoardAction(board.id, { description: d }));
                }}
              >
                Beschreibung …
              </button>
              <button type="button" className="btn btn-sm" onClick={() => run(() => updateBoardAction(board.id, { inLage: !board.inLage }))} title="Die offenen Karten gehen als KB-… in die Ticket-Lage: Todos, Lage je Karte, Berichte">
                {board.inLage ? "Aus der Lage nehmen" : "In die Lage"}
              </button>
              <Link href="/kanban/settings" className="btn btn-sm">
                Boards verwalten
              </Link>
            </div>
          </>
        }
      >
        {cols.map((col, i) => (
          <section key={col.id} className={COLUMN} aria-label={col.name}>
            <ColumnHead col={col} first={i === 0} last={i === cols.length - 1} run={run} />
            <div
              ref={(el) => {
                if (el) bodies.current.set(col.id, el);
              }}
              className={`flex min-h-12 flex-col gap-2 overflow-y-auto rounded-lg p-0.5 transition ${drop?.col === col.id ? "bg-indigo-100/70 dark:bg-indigo-950/50" : ""}`}
              onDragOver={(e) => {
                if (drag === null) return;
                e.preventDefault();
                const w = where(e, col.id);
                if (w.col !== drop?.col || w.before !== drop?.before) setDrop(w);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop((d) => (d?.col === col.id ? null : d));
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(col.id);
              }}
            >
              {col.cards.filter(matches).map((c) => (
                <div key={c.id}>
                  {drop?.col === col.id && drop.before === c.id && drag !== c.id && <div className="mb-2 h-1 rounded-full bg-indigo-500" />}
                  <Card
                    c={c}
                    lage={lage[c.ref]}
                    dragging={drag === c.id}
                    onOpen={() => setOpen(c.id)}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", c.ref);
                      setDrag(c.id);
                    }}
                    // Dropped outside a column (or Esc): nothing moves.
                    onDragEnd={() => {
                      setDrag(null);
                      setDrop(null);
                    }}
                  />
                </div>
              ))}
              {drop?.col === col.id && drop.before === null && <div className="h-1 rounded-full bg-indigo-500" />}
            </div>
            <AddCard columnId={col.id} run={run} />
          </section>
        ))}
        <form
          className="w-64 shrink-0 self-start rounded-xl border-2 border-dashed border-zinc-300 p-2 dark:border-zinc-700"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newCol.trim()) return;
            const n = newCol;
            setNewCol("");
            run(() => addColumnAction(board.id, n));
          }}
        >
          <input className="input text-sm" value={newCol} onChange={(e) => setNewCol(e.target.value)} placeholder="+ Spalte" aria-label="Neue Spalte" />
        </form>
      </BoardFrame>
      {opened && (
        <CardPanel
          key={`${opened.id}:${opened.updatedAt}`}
          c={opened}
          lage={lage[opened.ref]}
          people={people.map((p) => p.name).filter((n) => n !== NOBODY)}
          columns={cols}
          onClose={() => {
            setOpen(null);
            if (params.get("card")) router.replace(`/kanban/${board.id}`, { scroll: false });
          }}
          run={run}
        />
      )}
    </>
  );
}
