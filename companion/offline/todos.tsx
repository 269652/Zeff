import { useState } from "react";
import type { RTodo } from "@/lib/replica/shared";
import { useReplica } from "./main";
import { fmtDay, today, tr } from "./words";

const pendingKeys = (ops: { kind: string; todo?: unknown; tmp?: string }[]) => new Set(ops.map((o) => String(o.todo ?? o.tmp ?? "")));

/** The day `n` days from today (YYYY-MM-DD, local). */
const plusDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** A todo's reference as Zeff shows it (T-12) — a new one from the phone has none yet. */
const refOf = (t: RTodo) => (typeof t.id === "number" && t.id > 0 ? `T-${t.id}` : "");

/** Zeff's round check (src/components/boards/TodoItem.tsx): a circle, filled with a tick when done. */
function Check({ todo }: { todo: RTodo }) {
  const { edit } = useReplica();
  const closed = todo.status !== "open";
  return (
    <span className="relative mt-px flex size-[18px] shrink-0">
      <input
        type="checkbox"
        className="peer size-[18px] shrink-0 cursor-pointer appearance-none rounded-full border-[1.5px] border-zinc-400 bg-white transition checked:border-emerald-600 checked:bg-emerald-600 hover:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-none dark:border-zinc-500 dark:bg-zinc-900 dark:checked:bg-emerald-600"
        checked={closed}
        aria-label={todo.text}
        onChange={(e) => void edit({ kind: "todo.set", todo: todo.id, field: "status", value: e.target.checked ? "done" : "open" })}
      />
      <svg viewBox="0 0 16 16" className="pointer-events-none absolute inset-0 m-auto size-3 text-white opacity-0 peer-checked:opacity-100" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m3.5 8.5 3 3 6-7" />
      </svg>
    </span>
  );
}

/** When it's due, as Zeff's chip: red overdue, amber today, quiet later. */
function Due({ due, closed }: { due: string | null; closed: boolean }) {
  if (!due || closed) return null;
  const day = today();
  const tone = due < day ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" : due === day ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400";
  const text = due < day ? tr("overdueOn", { day: fmtDay(due) }) : due === day ? tr("dueToday") : tr("dueOn", { day: fmtDay(due) });
  return <span className={`rounded-full border px-1.5 leading-5 ${tone}`}>{text}</span>;
}

/** Your todos as in Zeff: due ones first (overdue, today), then later, then without a date; what you closed lately below. */
export function TodosView() {
  const { engine, edit } = useReplica();
  const [text, setText] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const all = engine.list("todo");
  const waiting = pendingKeys(engine.pending() as never);
  const day = today();
  const openTodos = all.filter((t) => t.status === "open").sort((a, b) => Number(b.flagged) - Number(a.flagged) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.createdAt.localeCompare(b.createdAt));
  // Deferred ones apart, below (as the Todos tab puts them aside).
  const now = openTodos.filter((t) => !t.deferred);
  const groups: [string, RTodo[], string][] = [
    ["Overdue", now.filter((t) => t.due && t.due < day), "bg-red-500"],
    ["Today", now.filter((t) => t.due === day), "bg-amber-500"],
    ["Later", now.filter((t) => t.due && t.due > day), "bg-sky-500"],
    ["No date", now.filter((t) => !t.due), "bg-zinc-400"],
    ["Deferred", openTodos.filter((t) => t.deferred), "bg-violet-400"],
  ];
  const [week] = useState(() => new Date(Date.now() - 7 * 864e5).toISOString());
  const done = all.filter((t) => t.status !== "open" && (t.doneAt ?? "") >= week).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
  const shown = open ? all.find((t) => String(t.id) === open) : undefined;
  if (shown) return <TodoDetail todo={shown} onBack={() => setOpen(null)} />;

  const item = (t: RTodo) => {
    const closed = t.status !== "open";
    return (
      <li key={t.id} data-zo="todo" className="group relative flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
        <Check todo={t} />
        <button type="button" className="min-w-0 flex-1 cursor-pointer text-left text-sm" onClick={() => setOpen(String(t.id))}>
          <span className={`block leading-snug ${closed ? "text-zinc-400 line-through" : "font-medium text-zinc-900 dark:text-zinc-100"}`}>
            {t.flagged && !closed && (
              <span data-zo="flag" className="mr-1 inline-flex align-[-2px] text-red-600 dark:text-red-400" aria-label={tr("Important")}>
                <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden>
                  <path d="M3.5 1.75v12.5M3.5 2.5h8l-1.75 3 1.75 3h-8" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
              </span>
            )}
            {t.text}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {[refOf(t), t.ticket].filter(Boolean).map((x, i) => (
              <span key={x} className={i === 0 ? "font-mono text-zinc-400" : ""}>
                {i > 0 && "· "}
                {x}
              </span>
            ))}
            <Due due={t.due} closed={closed} />
            {waiting.has(String(t.id)) && <span className="rounded-full bg-indigo-50 px-1.5 leading-5 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">{tr("pending")}</span>}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void edit({ kind: "todo.add", text: text.trim() });
          setText("");
        }}
      >
        <input className="input min-w-0 flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder={tr("newTodo")} aria-label={tr("newTodo")} />
        <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
          {tr("Add")}
        </button>
      </form>
      {!openTodos.length && <p className="px-1 text-sm text-zinc-500">{tr("Nothing open.")}</p>}
      {groups.map(([name, list, dot]) =>
        list.length ? (
          <section key={name} data-zo="open">
            <h2 className="mb-1 flex items-center gap-1.5 px-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
              {tr(name)} <span className="text-zinc-400">{list.length}</span>
            </h2>
            <ul className="card divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800">{list.map(item)}</ul>
          </section>
        ) : null,
      )}
      {done.length > 0 && (
        <details>
          <summary className="mb-1 cursor-pointer px-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {tr("Done")} <span className="ml-1 text-zinc-400">{done.length}</span>
          </summary>
          <ul className="card divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800">{done.map(item)}</ul>
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
    <div className="space-y-3">
      <button type="button" className="text-sm text-zinc-500 hover:underline" onClick={onBack}>
        ← {tr("Back")}
      </button>
      <section className="card space-y-3 p-4">
        <div className="flex items-start gap-3">
          <Check todo={todo} />
          <textarea
            className="input min-w-0 flex-1 text-base font-medium"
            rows={3}
            value={text}
            aria-label={tr("Title")}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text.trim() && text !== todo.text && void edit({ kind: "todo.set", todo: todo.id, field: "text", value: text.trim() })}
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="label">{tr("Due")}</span>
            <input className="input w-auto" type="date" value={todo.due ?? ""} onChange={(e) => void edit({ kind: "todo.set", todo: todo.id, field: "due", value: e.target.value || null })} />
          </label>
          <button
            type="button"
            className={`btn ${todo.flagged ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" : ""}`}
            aria-pressed={todo.flagged}
            onClick={() => void edit({ kind: "todo.set", todo: todo.id, field: "flagged", value: !todo.flagged })}
          >
            {tr("Important")}
          </button>
          <span className="text-xs text-zinc-500">{[refOf(todo), todo.ticket].filter(Boolean).join(" · ")}</span>
        </div>
        {/* Due at a tap, as the Todos tab's date menu: today, tomorrow, next week, none. */}
        <div className="flex flex-wrap gap-1.5">
          {[
            ["today", 0],
            ["tomorrow", 1],
            ["nextWeek", 7],
          ].map(([w, d]) => (
            <button key={w} type="button" className="btn btn-sm" onClick={() => void edit({ kind: "todo.set", todo: todo.id, field: "due", value: plusDays(Number(d)) })}>
              {tr(String(w))}
            </button>
          ))}
          {todo.due && (
            <button type="button" className="btn btn-sm" onClick={() => void edit({ kind: "todo.set", todo: todo.id, field: "due", value: null })}>
              {tr("noDate")}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          {todo.status === "open" && (
            <button type="button" className="btn" onClick={() => void edit({ kind: "todo.set", todo: todo.id, field: "deferred", value: !todo.deferred })}>
              {todo.deferred ? tr("undefer") : tr("defer")}
            </button>
          )}
          {todo.status === "dismissed" ? (
            <button type="button" className="btn" onClick={() => void edit({ kind: "todo.set", todo: todo.id, field: "status", value: "open" })}>
              {tr("reopen")}
            </button>
          ) : (
            <button
              type="button"
              className="btn text-red-700 dark:text-red-400"
              onClick={() => {
                void edit({ kind: "todo.set", todo: todo.id, field: "status", value: "dismissed" });
                onBack();
              }}
            >
              {tr("dismiss")}
            </button>
          )}
        </div>
      </section>
      <section className="card space-y-2 p-4">
        <h2 className="label">{tr("Notes")}</h2>
        {todo.notes.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {todo.notes.map((n) => (
              <li key={n.at}>
                <span className="mr-1.5 text-xs text-zinc-400">{fmtDay(n.at)}</span>
                {n.text}
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) return;
            void edit({ kind: "todo.note", todo: todo.id, text: note.trim() });
            setNote("");
          }}
        >
          <input className="input min-w-0 flex-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("Add a note …")} aria-label={tr("Add a note …")} />
          <button type="submit" className="btn" disabled={!note.trim()}>
            {tr("Add")}
          </button>
        </form>
      </section>
    </div>
  );
}
