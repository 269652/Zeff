import { useState } from "react";
import type { RTodo } from "@/lib/replica/shared";
import { useReplica } from "./main";
import { fmtDay, today, tr } from "./words";

const pendingKeys = (ops: { kind: string; todo?: unknown; tmp?: string }[]) => new Set(ops.map((o) => String(o.todo ?? o.tmp ?? "")));

/** Your todos: due ones first (overdue, today), then later, then without a date; what you closed lately below. */
export function TodosView() {
  const { engine, edit } = useReplica();
  const [text, setText] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const all = engine.list("todo");
  const waiting = pendingKeys(engine.pending() as never);
  const day = today();
  const openTodos = all.filter((t) => t.status === "open").sort((a, b) => Number(b.flagged) - Number(a.flagged) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.createdAt.localeCompare(b.createdAt));
  const groups: [string, RTodo[]][] = [
    ["Overdue", openTodos.filter((t) => t.due && t.due < day)],
    ["Today", openTodos.filter((t) => t.due === day)],
    ["Later", openTodos.filter((t) => t.due && t.due > day)],
    ["No date", openTodos.filter((t) => !t.due)],
  ];
  const [week] = useState(() => new Date(Date.now() - 7 * 864e5).toISOString());
  const done = all.filter((t) => t.status !== "open" && (t.doneAt ?? "") >= week).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
  const shown = open ? all.find((t) => String(t.id) === open) : undefined;
  if (shown) return <TodoDetail todo={shown} onBack={() => setOpen(null)} />;

  const item = (t: RTodo) => (
    <li key={t.id} className="zo-todo">
      <input type="checkbox" checked={t.status !== "open"} aria-label={t.text} onChange={(e) => void edit({ kind: "todo.set", todo: t.id, field: "status", value: e.target.checked ? "done" : "open" })} />
      <button type="button" className="zo-todo-text" onClick={() => setOpen(String(t.id))}>
        {t.flagged && <span className="zo-flag">❗</span>}
        <span className={t.status !== "open" ? "zo-done" : ""}>{t.text}</span>
        <small>
          {[t.ticket, t.due ? fmtDay(t.due) : null, waiting.has(String(t.id)) ? tr("pending") : null].filter(Boolean).join(" · ")}
        </small>
      </button>
    </li>
  );

  return (
    <div className="zo-page">
      <form
        className="zo-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void edit({ kind: "todo.add", text: text.trim() });
          setText("");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tr("newTodo")} aria-label={tr("newTodo")} />
        <button type="submit" className="zo-btn primary" disabled={!text.trim()}>
          {tr("Add")}
        </button>
      </form>
      {!openTodos.length && <p className="zo-muted">{tr("Nothing open.")}</p>}
      {groups.map(([name, list]) =>
        list.length ? (
          <section key={name}>
            <h2 className={name === "Overdue" ? "zo-h zo-red" : "zo-h"}>
              {tr(name)} <span>{list.length}</span>
            </h2>
            <ul className="zo-list">{list.map(item)}</ul>
          </section>
        ) : null,
      )}
      {done.length > 0 && (
        <details>
          <summary className="zo-h">
            {tr("Done")} <span>{done.length}</span>
          </summary>
          <ul className="zo-list">{done.map(item)}</ul>
        </details>
      )}
    </div>
  );
}

function TodoDetail({ todo, onBack }: { todo: RTodo; onBack: () => void }) {
  const { edit } = useReplica();
  const [text, setText] = useState(todo.text);
  const [note, setNote] = useState("");
  return (
    <div className="zo-page">
      <button type="button" className="zo-back" onClick={onBack}>
        ← {tr("Back")}
      </button>
      <label className="zo-field">
        <span>{tr("Title")}</span>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() && text !== todo.text && void edit({ kind: "todo.set", todo: todo.id, field: "text", value: text.trim() })} />
      </label>
      <label className="zo-field">
        <span>{tr("Due")}</span>
        <input type="date" value={todo.due ?? ""} onChange={(e) => void edit({ kind: "todo.set", todo: todo.id, field: "due", value: e.target.value || null })} />
      </label>
      <label className="zo-check">
        <input type="checkbox" checked={todo.flagged} onChange={(e) => void edit({ kind: "todo.set", todo: todo.id, field: "flagged", value: e.target.checked })} /> {tr("Important")}
      </label>
      <label className="zo-check">
        <input type="checkbox" checked={todo.status !== "open"} onChange={(e) => void edit({ kind: "todo.set", todo: todo.id, field: "status", value: e.target.checked ? "done" : "open" })} /> {tr("Done")}
      </label>
      <h2 className="zo-h">{tr("Notes")}</h2>
      <ul className="zo-notes">
        {todo.notes.map((n) => (
          <li key={n.at}>
            <small>{fmtDay(n.at)}</small> {n.text}
          </li>
        ))}
      </ul>
      <form
        className="zo-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) return;
          void edit({ kind: "todo.note", todo: todo.id, text: note.trim() });
          setNote("");
        }}
      >
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("Add a note …")} aria-label={tr("Add a note …")} />
        <button type="submit" className="zo-btn" disabled={!note.trim()}>
          {tr("Add")}
        </button>
      </form>
    </div>
  );
}
