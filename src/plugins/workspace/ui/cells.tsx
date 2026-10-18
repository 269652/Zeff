"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { Markdown } from "@/components/Markdown";
import { aiFillCellAction, cellChoicesAction, type DatabaseData } from "../actions";
import { choiceColor, COLORS, dateRange, formatNumber, isComputed, newId, type Option, type Property, type Row } from "../model";
import { Dropdown, useDismiss } from "./kit";

/** The cells of a database: how each property type is shown, and edited in place. */

export type CellCtx = {
  data: DatabaseData;
  /** Set a stored value. */
  set: (rowId: number, propId: string, value: unknown) => void;
  /** Add an option to a select / multi-select / status property; returns its id. */
  addOption: (propId: string, name: string) => string;
  editable: boolean;
  /** Open a row of this database over it (a relation to the same database — a card's parent — opens there). */
  openRow?: (id: number) => void;
};

const hrefOf = (v: string) => (/^https?:\/\//i.test(v) || /^\/(?!\/)/.test(v) ? v : /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v) ? `https://${v}` : "");
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]);

export function Tag({ option }: { option: Option }) {
  return (
    <span className="ws-tag" data-color={option.color}>
      {option.name}
    </span>
  );
}

/** A cell as it is shown (not editing). */
export function CellView({ p, row, ctx }: { p: Property; row: Row; ctx: CellCtx }) {
  const t = useT();
  const v = row.cells[p.id];
  const err = row.cells[`${p.id}!`];
  if (err) return <span className="text-xs text-red-600 dark:text-red-400" title={String(err)}>⚠ {String(err)}</span>;
  const { labels } = ctx.data;
  switch (p.type) {
    case "select":
    case "status": {
      const o = p.options?.find((x) => x.id === v);
      return o ? <Tag option={o} /> : null;
    }
    case "multi_select":
      return (
        <>
          {asArr(v).map((id) => {
            const o = p.options?.find((x) => x.id === id);
            return o ? <Tag key={o.id} option={o} /> : null;
          })}
        </>
      );
    case "checkbox":
      return <input type="checkbox" checked={!!v} disabled={!ctx.editable} onChange={(e) => ctx.set(row.id, p.id, e.target.checked)} aria-label={p.name} className="size-4 accent-indigo-600" />;
    case "number":
      return typeof v === "number" ? <span>{formatNumber(p, v)}</span> : null;
    case "date": {
      const r = dateRange(v);
      return r ? <span>{r.end ? `${r.start.replace("T", " ")} → ${r.end.replace("T", " ")}` : r.start.replace("T", " ")}</span> : null;
    }
    case "created_time":
    case "updated_time":
      return <span className="text-zinc-500">{String(v ?? "").slice(0, 16).replace("T", " ")}</span>;
    case "url":
    case "email":
    case "phone": {
      const s = String(v ?? "");
      if (!s) return null;
      const href = p.type === "url" ? hrefOf(s) : p.type === "email" ? `mailto:${s}` : `tel:${s}`;
      return (
        <a href={href || undefined} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="truncate text-indigo-600 underline dark:text-indigo-400">
          {s}
        </a>
      );
    }
    case "custom": {
      const ft = ctx.data.extras?.fieldTypes?.find((f) => f.id === p.custom);
      if (v === null || v === undefined || v === "") return null;
      if (ft?.display === "rating") {
        const n = Math.round(Number(v)) || 0;
        const max = ft.max ?? 5;
        return (
          <span className="whitespace-nowrap text-amber-500" aria-label={`${n}/${max}`} title={`${n}/${max}`}>
            {"★".repeat(Math.min(n, max))}
            <span className="text-zinc-300 dark:text-zinc-600">{"★".repeat(Math.max(0, max - n))}</span>
          </span>
        );
      }
      if (ft?.display === "progress") {
        const n = Math.max(0, Math.min(100, Number(v) || 0));
        return (
          <span className="flex w-full min-w-16 items-center gap-1.5" title={`${n} %`}>
            <span className="h-2 flex-1 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
              <span className="block h-full rounded bg-indigo-500" style={{ width: `${n}%` }} />
            </span>
            <span className="text-xs text-zinc-500 tabular-nums">{n}</span>
          </span>
        );
      }
      if (ft?.display === "badge") return <span className="ws-tag">{String(v)}</span>;
      if (ft?.display === "link" && ft.href) {
        const href = ft.href.replace("{value}", encodeURIComponent(String(v)));
        return (
          <a href={/^https?:\/\//i.test(href) ? href : undefined} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="truncate text-indigo-600 underline dark:text-indigo-400">
            {String(v)}
          </a>
        );
      }
      return <span>{String(v)}</span>;
    }
    case "person":
      return (
        <>
          {asArr(v).map((id) => (
            <Link key={String(id)} href={labels.personHref?.[Number(id)] ?? "/workspace"} onClick={(e) => e.stopPropagation()} className="ws-chip" data-kind="person">
              👤 {labels.people[Number(id)] ?? `#${id}`}
            </Link>
          ))}
        </>
      );
    case "todo":
      return (
        <>
          {asArr(v).map((id) => (
            <Link key={String(id)} href={`/t/${id}`} onClick={(e) => e.stopPropagation()} className="ws-chip" data-kind="todo">
              {labels.todos[Number(id)] ?? `T-${id}`}
            </Link>
          ))}
        </>
      );
    case "ticket":
      return (
        <>
          {asArr(v).map((k) => (
            <span key={String(k)} className="ws-chip" data-kind="ticket">
              🎫 {String(k)}
            </span>
          ))}
        </>
      );
    case "relation":
      return (
        <>
          {asArr(v).map((id) => {
            const pg = labels.pages[Number(id)];
            return (
              <Link
                key={String(id)}
                href={`/workspace/${id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (ctx.openRow && p.relationDb === ctx.data.id) {
                    e.preventDefault();
                    ctx.openRow(Number(id));
                  }
                }}
                className="ws-chip"
                data-kind="page"
              >
                {pg?.icon || "📄"} {pg?.title ?? `#${id}`}
              </Link>
            );
          })}
        </>
      );
    case "rollup":
    case "formula": {
      if (v === null || v === undefined || v === "") return null;
      if (typeof v === "number") return <span>{formatNumber(p, v)}</span>;
      if (typeof v === "boolean") return <span>{v ? t("Yes") : t("No")}</span>;
      if (Array.isArray(v)) return <span>{v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ")}</span>;
      return <span>{String(v)}</span>;
    }
    case "markdown":
      return v ? <div className="max-h-40 overflow-hidden"><Markdown text={String(v)} /></div> : null;
    case "ai":
      // A choice of its own list: a coloured tag, as a select's.
      if (v && p.aiChoices?.includes(String(v))) return <Tag option={{ id: String(v), name: String(v), color: choiceColor(p, String(v)) }} />;
      return v ? <span className="line-clamp-3 whitespace-pre-wrap">{String(v)}</span> : <span className="text-xs text-violet-600 dark:text-violet-300">✨ {t("Fill")}</span>;
    default:
      return v ? <span className="line-clamp-4 break-words whitespace-pre-wrap">{String(v)}</span> : null;
  }
}

/** A cell editable in place: click it to change it. */
export function Cell({ p, row, ctx, className = "", empty }: { p: Property; row: Row; ctx: CellCtx; className?: string; /** Shown when the cell has no value (the row page). */ empty?: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  if (isComputed(p) || p.type === "checkbox" || !ctx.editable) {
    return (
      <div className={`ws-cell ${className}`} style={{ cursor: "default" }}>
        <CellView p={p} row={row} ctx={ctx} />
      </div>
    );
  }
  if (!editing)
    return (
      <button type="button" className={`ws-cell ${className}`} onClick={() => setEditing(true)} aria-label={p.name}>
        {empty && (row.cells[p.id] === undefined || row.cells[p.id] === null || row.cells[p.id] === "") ? empty : <CellView p={p} row={row} ctx={ctx} />}
      </button>
    );
  return <CellEditor p={p} row={row} ctx={ctx} done={() => setEditing(false)} />;
}

function TextEditor({ p, row, ctx, done }: { p: Property; row: Row; ctx: CellCtx; done: () => void }) {
  const t = useT();
  const ft = p.type === "custom" ? ctx.data.extras?.fieldTypes?.find((f) => f.id === p.custom) : undefined;
  const v = row.cells[p.id];
  const [text, setText] = useState(Array.isArray(v) ? v.join(", ") : typeof v === "string" || typeof v === "number" ? String(v) : "");
  const commit = () => {
    const raw = text.trim();
    ctx.set(row.id, p.id, p.type === "number" ? (raw === "" ? null : raw) : p.type === "ticket" ? raw.split(/[\s,;]+/).filter(Boolean) : raw || null);
    done();
  };
  const multiline = p.type === "text" || p.type === "markdown" || p.type === "ai";
  const props = {
    autoFocus: true,
    value: text,
    className: "ws-cell-input",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") done();
      if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey || !e.shiftKey)) {
        e.preventDefault();
        commit();
      }
    },
    "aria-label": p.name,
    placeholder: p.type === "ticket" ? t("PROJ-339, …") : undefined,
  };
  if (multiline) return <textarea rows={p.type === "markdown" ? 6 : 2} {...props} />;
  const listId = ft?.suggestions.length ? `ft-${p.id}-${row.id}` : undefined;
  return (
    <>
      <input inputMode={p.type === "number" || ft?.display === "rating" || ft?.display === "progress" ? "decimal" : undefined} list={listId} {...props} />
      {listId && (
        <datalist id={listId}>
          {ft!.suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </>
  );
}

function DateEditor({ p, row, ctx, done }: { p: Property; row: Row; ctx: CellCtx; done: () => void }) {
  const t = useT();
  const r = dateRange(row.cells[p.id]);
  const [start, setStart] = useState(r?.start ?? "");
  const [end, setEnd] = useState(r?.end ?? "");
  const [range, setRange] = useState(!!r?.end);
  const ref = useRef<HTMLDivElement>(null);
  const time = !!p.includeTime;
  const commit = () => {
    ctx.set(row.id, p.id, start ? (range && end ? { start, end } : start) : null);
    done();
  };
  useDismiss(ref, true, commit);
  const type = time ? "datetime-local" : "date";
  return (
    <div ref={ref} className="space-y-1 p-1">
      <input type={type} className="input w-full text-sm" autoFocus value={start} onChange={(e) => setStart(e.target.value)} aria-label={t("Start")} />
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={range} onChange={(e) => setRange(e.target.checked)} /> {t("End date")}
      </label>
      {range && <input type={type} className="input w-full text-sm" value={end} min={start} onChange={(e) => setEnd(e.target.value)} aria-label={t("End")} />}
      <div className="flex gap-1">
        <button type="button" className="btn btn-sm btn-primary" onClick={commit}>
          {t("Done")}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            ctx.set(row.id, p.id, null);
            done();
          }}
        >
          {t("Clear")}
        </button>
      </div>
    </div>
  );
}

function OptionEditor({ p, row, ctx, done }: { p: Property; row: Row; ctx: CellCtx; done: () => void }) {
  const t = useT();
  const multi = p.type === "multi_select";
  const current = asArr(row.cells[p.id]) as string[];
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, true, done);
  const opts = (p.options ?? []).filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
  const exists = (p.options ?? []).some((o) => o.name.toLowerCase() === q.trim().toLowerCase());
  const pick = (id: string) => {
    if (multi) ctx.set(row.id, p.id, current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
    else {
      ctx.set(row.id, p.id, id === current[0] ? null : id);
      done();
    }
  };
  return (
    <div ref={ref} className="w-56 space-y-1 p-1">
      <input autoFocus className="input w-full text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search or create …")} aria-label={t("Search or create")} onKeyDown={(e) => {
        if (e.key === "Enter" && q.trim()) {
          e.preventDefault();
          const hit = opts.find((o) => o.name.toLowerCase() === q.trim().toLowerCase()) ?? (opts.length === 1 && !exists ? opts[0] : undefined);
          if (hit) pick(hit.id);
          else if (!exists) {
            const id = ctx.addOption(p.id, q.trim());
            pick(id);
            setQ("");
          }
        }
        if (e.key === "Escape") done();
      }} />
      <ul className="max-h-48 overflow-y-auto">
        {opts.map((o) => (
          <li key={o.id}>
            <button type="button" className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => pick(o.id)}>
              <span className="w-3 text-xs">{current.includes(o.id) ? "✓" : ""}</span>
              <Tag option={o} />
            </button>
          </li>
        ))}
        {q.trim() && !exists && (
          <li>
            <button
              type="button"
              className="w-full rounded px-1.5 py-1 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => {
                const id = ctx.addOption(p.id, q.trim());
                pick(id);
                setQ("");
              }}
            >
              + {t("Create “{name}”", { name: q.trim() })}
            </button>
          </li>
        )}
      </ul>
      {multi && (
        <button type="button" className="btn btn-sm w-full" onClick={done}>
          {t("Done")}
        </button>
      )}
    </div>
  );
}

function LinkEditor({ p, row, ctx, done }: { p: Property; row: Row; ctx: CellCtx; done: () => void }) {
  const t = useT();
  const current = (asArr(row.cells[p.id]) as number[]).map(Number);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<{ id: number; label: string; icon?: string }[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, true, done);
  const related = p.relationDb !== undefined ? ctx.data.related[p.relationDb] : undefined;
  useEffect(() => {
    if (p.type === "relation") {
      const w = q.trim().toLowerCase();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the choices follow what is typed
      setItems((related?.rows ?? []).filter((r) => !w || r.title.toLowerCase().includes(w)).slice(0, 30).map((r) => ({ id: r.id, label: r.title || t("Untitled"), icon: r.icon })));
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void cellChoicesAction(p.type === "person" ? "person" : "todo", q).then((r) => live && r.ok && setItems(r.items));
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, p.type, related, t]);
  const toggle = (id: number) => ctx.set(row.id, p.id, current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  return (
    <div ref={ref} className="w-64 space-y-1 p-1">
      <input autoFocus className="input w-full text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search …")} aria-label={t("Search")} onKeyDown={(e) => e.key === "Escape" && done()} />
      <ul className="max-h-52 overflow-y-auto">
        {items.map((it) => (
          <li key={it.id}>
            <button type="button" className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => toggle(it.id)}>
              <span className="w-3 text-xs">{current.includes(it.id) ? "✓" : ""}</span>
              <span className="truncate">
                {it.icon ? `${it.icon} ` : ""}
                {it.label}
              </span>
            </button>
          </li>
        ))}
        {!items.length && <li className="px-1.5 py-1 text-xs text-zinc-500">{t("Nothing found")}</li>}
      </ul>
      <button type="button" className="btn btn-sm w-full" onClick={done}>
        {t("Done")}
      </button>
    </div>
  );
}

function AiEditor({ p, row, ctx, done }: { p: Property; row: Row; ctx: CellCtx; done: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [text, setText] = useState(String(row.cells[p.id] ?? ""));
  return (
    <div className="space-y-1 p-1">
      <textarea autoFocus rows={3} className="ws-cell-input" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== String(row.cells[p.id] ?? "") && ctx.set(row.id, p.id, text || null)} aria-label={p.name} />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr("");
            const r = await aiFillCellAction(row.id, p.id);
            setBusy(false);
            if (r.ok) {
              setText(r.value);
              ctx.set(row.id, p.id, r.value);
            } else setErr(r.error);
          }}
        >
          ✨ {busy ? t("Working …") : t("Fill with AI")}
        </button>
        <button type="button" className="btn btn-sm" onClick={done}>
          {t("Done")}
        </button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  );
}

/** Stars to click: the same star again clears the rating. */
function StarsEditor({ p, row, ctx, max, done }: { p: Property; row: Row; ctx: CellCtx; max: number; done: () => void }) {
  const now = Math.round(Number(row.cells[p.id])) || 0;
  return (
    <span className="flex gap-0.5 text-lg text-amber-500" role="group" aria-label={p.name}>
      {Array.from({ length: max }, (_, i) => (
        <button
          key={i}
          type="button"
          autoFocus={i === 0}
          aria-label={`${i + 1}`}
          className={i < now ? "" : "text-zinc-300 hover:text-amber-400 dark:text-zinc-600"}
          onClick={() => (ctx.set(row.id, p.id, now === i + 1 ? null : i + 1), done())}
          onKeyDown={(e) => e.key === "Escape" && done()}
        >
          ★
        </button>
      ))}
    </span>
  );
}

export function CellEditor({ p, row, ctx, done }: { p: Property; row: Row; ctx: CellCtx; done: () => void }) {
  const ft = p.type === "custom" ? ctx.data.extras?.fieldTypes?.find((f) => f.id === p.custom) : undefined;
  if (ft?.display === "rating") return <StarsEditor p={p} row={row} ctx={ctx} max={ft.max ?? 5} done={done} />;
  if (p.type === "ai") return <AiEditor p={p} row={row} ctx={ctx} done={done} />;
  if (p.type === "date") return <DateEditor p={p} row={row} ctx={ctx} done={done} />;
  if (p.type === "select" || p.type === "status" || p.type === "multi_select") return <OptionEditor p={p} row={row} ctx={ctx} done={done} />;
  if (p.type === "person" || p.type === "todo" || p.type === "relation") return <LinkEditor p={p} row={row} ctx={ctx} done={done} />;
  return <TextEditor p={p} row={row} ctx={ctx} done={done} />;
}

/** Add an option object (used by the schema editor too). */
export const makeOption = (name: string, index: number, group?: Option["group"]): Option => ({ id: newId("o"), name, color: COLORS[(index + 1) % COLORS.length], group });

/** A dropdown that shows the cell editor in a popover (cards, the row page's property list). */
export function PopCell({ p, row, ctx }: { p: Property; row: Row; ctx: CellCtx }) {
  const t = useT();
  const empty = !p.type.startsWith("check") && (row.cells[p.id] === undefined || row.cells[p.id] === null || row.cells[p.id] === "" || (Array.isArray(row.cells[p.id]) && (row.cells[p.id] as unknown[]).length === 0));
  const hint = <span className="text-zinc-400">{t("Empty")}</span>;
  if (isComputed(p) || p.type === "checkbox" || !ctx.editable) return empty && p.type !== "checkbox" ? hint : <CellView p={p} row={row} ctx={ctx} />;
  if (p.type === "text" || p.type === "markdown" || p.type === "number" || p.type === "url" || p.type === "email" || p.type === "phone" || p.type === "ticket" || p.type === "custom") return <Cell p={p} row={row} ctx={ctx} className="rounded-md" empty={hint} />;
  return (
    <Dropdown label={empty ? hint : <CellView p={p} row={row} ctx={ctx} />} className="flex min-h-7 flex-wrap items-center gap-1 rounded-md px-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800">
      {(close) => <CellEditor p={p} row={row} ctx={ctx} done={close} />}
    </Dropdown>
  );
}
