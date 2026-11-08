"use client";

import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { TITLE } from "../model";
import { Dropdown } from "./kit";
import type { VNode } from "../view-template";
import type { AppViewProps } from "./app-view";

/**
 * The view language's bigger building blocks, one look for all of them: a page header, a callout, an empty state, facts, a gallery, a
 * timeline, a board, filters by value, a quick entry, a form. Each is drawn from nodes the template made (view-template.ts) and knows
 * nothing of a particular app. Colours come from the theme's zinc and tones, no fades: the contrast stays what globals.css keeps.
 */

type Node = Extract<VNode, object>;
type Kids = (nodes: VNode[]) => ReactNode;
export type BlockEnv = { props: AppViewProps; state: Record<string, string>; setState: (name: string, value: string) => void; run: (a: Record<string, string>) => void };

const TONES: Record<string, { box: string; text: string; bar: string }> = {
  info: { box: "border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/30", text: "text-indigo-800 dark:text-indigo-200", bar: "bg-indigo-500" },
  good: { box: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30", text: "text-emerald-800 dark:text-emerald-200", bar: "bg-emerald-500" },
  warn: { box: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30", text: "text-amber-900 dark:text-amber-200", bar: "bg-amber-500" },
  bad: { box: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30", text: "text-red-800 dark:text-red-200", bar: "bg-red-500" },
};
const json = <T,>(s: string | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};
const items = (n: Node) => n.c.filter((c): c is Node => typeof c !== "string");
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

/** A little line of numbers. */
export function Sparkline({ values, className = "h-6 w-20" }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 26}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={`${className} text-indigo-500`} aria-hidden>
      <polyline fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" points={points} />
    </svg>
  );
}

/** Nothing here yet: says so, and what to do about it. */
export function EmptyState({ icon, title, text, children }: { icon?: string; title?: string; text?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-zinc-300 px-6 py-8 text-center dark:border-zinc-700">
      {icon && <span className="text-2xl" aria-hidden>{icon}</span>}
      {title && <p className="text-sm font-medium">{title}</p>}
      {text && <p className="max-w-prose text-sm text-zinc-500">{text}</p>}
      {children && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  );
}

function Picture({ src, ratio, alt, name }: { src: string; ratio: string; alt: string; /** Stands in for a missing picture. */ name?: string }) {
  if (!src)
    return (
      <div className="flex w-full items-center justify-center bg-zinc-100 text-3xl font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" style={{ aspectRatio: ratio }} aria-hidden>
        {initials(name ?? "")}
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element -- a picture named by the template: from anywhere, no loader
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" className="w-full bg-zinc-100 object-cover dark:bg-zinc-800" style={{ aspectRatio: ratio }} />;
}

function Gallery({ n, kids, env }: { n: Node; kids: Kids; env: BlockEnv }) {
  const list = items(n);
  if (!list.length) return n.a.empty ? <EmptyState text={n.a.empty} /> : null;
  const ratio = { "2:3": "2 / 3", "1:1": "1 / 1", "16:9": "16 / 9", "3:2": "3 / 2" }[n.a.ratio ?? ""] ?? "2 / 3";
  const min = Number(n.a.min) || 150;
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.min(400, min)}px, 1fr))` }}>
      {list.map((it, i) => {
        const open = () => it.a.row && env.props.openRow(Number(it.a.row));
        return (
          <article key={it.a.row ?? i} className="group min-w-0">
            <button type="button" className="block w-full cursor-pointer overflow-hidden rounded-lg border border-zinc-200 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800" aria-label={it.a.alt || undefined} onClick={open}>
              <Picture src={it.a.image ?? ""} ratio={ratio} alt="" name={it.a.alt} />
            </button>
            <div className="mt-2 flex min-w-0 flex-col gap-0.5 text-sm">{kids(it.c)}</div>
          </article>
        );
      })}
    </div>
  );
}

function Timeline({ n, kids }: { n: Node; kids: Kids }) {
  const list = items(n);
  if (!list.length) return n.a.empty ? <EmptyState text={n.a.empty} /> : null;
  return (
    <ol className="relative ml-1.5 space-y-5 border-l border-zinc-200 pl-5 dark:border-zinc-800">
      {list.map((it, i) => (
        <li key={it.a.row ?? i} className="relative">
          <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-indigo-500 ring-4 ring-white dark:ring-zinc-950" aria-hidden />
          {it.a.date && <div className="text-xs font-medium text-zinc-500">{it.a.date}</div>}
          <div className="flex min-w-0 flex-col gap-1 text-sm">{kids(it.c)}</div>
        </li>
      ))}
    </ol>
  );
}

/** Rows in columns by a select or status: dragged to another column, the row takes its value. */
function Board({ n, kids, env }: { n: Node; kids: Kids; env: BlockEnv }) {
  const t = useT();
  const [over, setOver] = useState<string | null>(null);
  const cols = json<{ id: string; name: string }[]>(n.a.cols, []);
  const list = items(n);
  const drop = (e: DragEvent, col: string) => {
    e.preventDefault();
    setOver(null);
    const row = Number(e.dataTransfer.getData("text/plain"));
    if (row) env.props.ctx?.set(row, n.a.prop, col || null);
  };
  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-2" role="list" aria-label={t("Board")}>
      {cols.map((c) => {
        const here = list.filter((it) => (it.a.col ?? "") === c.id);
        return (
          <section
            key={c.id}
            role="listitem"
            aria-label={c.name}
            className={`w-64 shrink-0 rounded-xl border p-2 ${over === c.id ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30" : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40"}`}
            onDragOver={(e) => (e.preventDefault(), setOver(c.id))}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => drop(e, c.id)}
          >
            <header className="flex items-center justify-between px-1 pb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              <span className="truncate">{c.name}</span>
              <span className="tabular-nums">{here.length}</span>
            </header>
            <div className="flex min-h-10 flex-col gap-2">
              {here.map((it, i) => (
                <article
                  key={it.a.row ?? i}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", it.a.row ?? "")}
                  className="min-w-0 cursor-grab rounded-lg border border-zinc-200 bg-white p-2.5 text-sm shadow-xs transition hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                  onClick={() => it.a.row && env.props.openRow(Number(it.a.row))}
                >
                  <div className="flex min-w-0 flex-col gap-1">{kids(it.c)}</div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** One click on a value: the rows narrow to it, again: all. */
function Facets({ a, env }: { a: Record<string, string>; env: BlockEnv }) {
  const t = useT();
  const opts = json<[string, string, number][]>(a.options, []);
  const current = a.current ?? "";
  const pill = (value: string, label: string, n: number | null) => (
    <button key={value || "*"} type="button" aria-pressed={current === value} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${current === value ? "border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500" : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"}`} onClick={() => env.setState(a.bind, current === value ? "" : value)}>
      {label}
      {n !== null && <span className="tabular-nums">{n}</span>}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5 print:hidden" role="group" aria-label={a.label ?? t("Filter")}>
      {pill("", a.all ?? t("All"), opts.reduce((s, o) => s + o[2], 0))}
      {opts.map(([v, label, count]) => pill(v, label, count))}
    </div>
  );
}

/** A line to type a new row's title into: Enter adds it, the field stays for the next. */
function QuickAdd({ a, env }: { a: Record<string, string>; env: BlockEnv }) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const title = text.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await env.props.rowOps?.add(json<Record<string, unknown>>(a.values, {}), title);
      setText("");
    } catch (x) {
      toast(x instanceof Error ? x.message : String(x), { tone: "error" });
    }
    setBusy(false);
  };
  const label = a.placeholder ?? t("Add …");
  return (
    <form className="flex min-w-0 flex-1 items-center gap-2 print:hidden" onSubmit={add} onClick={(e) => e.stopPropagation()}>
      <input className="input min-w-0 flex-1 py-1 text-sm" aria-label={label} placeholder={label} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
      <button className="btn btn-sm" disabled={busy || !text.trim()}>
        {a.label ?? t("Add")}
      </button>
    </form>
  );
}

type FormField = { id: string; name: string; type: string; options?: { id: string; name: string }[] };

/** The fields named, to fill in at once: a new row. */
function RowForm({ a, env }: { a: Record<string, string>; env: BlockEnv }) {
  const t = useT();
  const fields = json<FormField[]>(a.fields, []);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (id: string, v: string) => setValues((s) => ({ ...s, [id]: v }));
  const value = (f: FormField, v: string): unknown => (f.type === "number" ? Number(v.replace(",", ".")) : f.type === "checkbox" ? v === "true" : f.type === "multi_select" ? [v] : v);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const cells = Object.fromEntries(fields.filter((f) => f.id !== TITLE && values[f.id]).map((f) => [f.id, value(f, values[f.id])]));
      await env.props.rowOps?.add(cells, values[TITLE] ?? "");
      setValues({});
      toast(a.done ?? t("Added."));
    } catch (x) {
      toast(x instanceof Error ? x.message : String(x), { tone: "error" });
    }
    setBusy(false);
  };
  return (
    <form className="space-y-3 rounded-xl border border-zinc-200 p-4 print:hidden dark:border-zinc-800" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
      {a.title && <h3 className="text-sm font-semibold">{a.title}</h3>}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        {fields.map((f) => (
          <label key={f.id} className="block text-sm">
            <span className="label">{f.name}</span>
            {f.options ? (
              <select className="input" value={values[f.id] ?? ""} onChange={(e) => set(f.id, e.target.value)}>
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : f.type === "checkbox" ? (
              <input type="checkbox" className="accent-indigo-600" checked={values[f.id] === "true"} onChange={(e) => set(f.id, e.target.checked ? "true" : "")} />
            ) : (
              <input className="input" type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "url" ? "url" : "text"} step="any" value={values[f.id] ?? ""} onChange={(e) => set(f.id, e.target.value)} />
            )}
          </label>
        ))}
      </div>
      <button className="btn btn-primary btn-sm" disabled={busy || (fields.some((f) => f.id === TITLE) && !values[TITLE]?.trim())}>
        {a.label ?? t("Add")}
      </button>
    </form>
  );
}

/** <menu>: a ⋯ button, its children (toggles, buttons used now and then) in the dropdown under it, one per line. */
function MenuBlock({ a, kids }: { a: Record<string, string>; kids: () => ReactNode }) {
  const t = useT();
  return (
    <Dropdown label={a.label || "⋯"} align="right" title={a.tip} ariaLabel={a.tip || t("More")} wrapClassName="relative ml-auto inline-block print:hidden">
      {() => <div className="flex flex-col gap-0.5 [&>*]:rounded-md [&>*]:px-2 [&>*]:py-1.5 [&>label:hover]:bg-zinc-100 dark:[&>label:hover]:bg-zinc-800">{kids()}</div>}
    </Dropdown>
  );
}

/** A node of the bigger blocks drawn — undefined: not one of them. */
export function viewBlock(n: Node, key: string | number, kids: Kids, env: BlockEnv): ReactNode | undefined {
  const a = n.a;
  switch (n.t) {
    case "header":
      return (
        <header key={key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-start gap-3">
            {a.icon && <span className="text-2xl leading-8" aria-hidden>{a.icon}</span>}
            <div className="min-w-0">
              <h1 className="text-xl leading-8 font-semibold tracking-tight">{a.title}</h1>
              {a.subtitle && <p className="text-sm text-zinc-500">{a.subtitle}</p>}
            </div>
          </div>
          {n.c.length > 0 && <div className="flex flex-wrap items-center gap-2">{kids(n.c)}</div>}
        </header>
      );
    case "toolbar":
      return (
        <div key={key} className="ws-toolbar flex flex-wrap items-center gap-2 border-b border-zinc-200 pb-3 print:hidden dark:border-zinc-800">
          {kids(n.c)}
        </div>
      );
    case "menu":
      return <MenuBlock key={key} a={a} kids={() => kids(n.c)} />;
    case "panes": {
      const list = items(n);
      const columns = list.map((p) => (Number(p.a.width) > 0 ? `${Math.min(640, Number(p.a.width))}px` : "minmax(0,1fr)")).join(" ");
      return (
        <FillHeight key={key} className="ws-panes grid gap-3" style={{ "--panes": columns } as CSSProperties}>
          {list.map((p, i) => (
            <section key={i} aria-label={p.a.title || undefined} className="flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              {(p.a.title || p.a.aside) && (
                <header className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
                  <h2 className="truncate text-sm font-semibold">{p.a.title}</h2>
                  {p.a.aside && <span className="text-xs text-zinc-500 tabular-nums">{p.a.aside}</span>}
                </header>
              )}
              <div className={p.a.flush === "true" ? "flex min-h-0 flex-1 flex-col" : "min-h-0 flex-1 space-y-3 overflow-y-auto p-3"}>{kids(p.c)}</div>
            </section>
          ))}
        </FillHeight>
      );
    }
    case "cover":
      return (
        <div key={key} className="relative overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800" style={{ height: Math.min(420, Number(a.h) || 180) }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a picture named by the template: from anywhere, no loader */}
          {a.src && <img src={a.src} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />}
          {(a.title || a.subtitle) && (
            <div className="absolute inset-x-0 bottom-0 bg-zinc-950/70 px-4 py-3 text-white">
              {a.title && <div className="text-lg font-semibold">{a.title}</div>}
              {a.subtitle && <div className="text-sm">{a.subtitle}</div>}
            </div>
          )}
        </div>
      );
    case "callout": {
      const tone = TONES[a.tone ?? "info"] ?? TONES.info;
      return (
        <div key={key} role={a.tone === "bad" ? "alert" : undefined} className={`flex gap-3 rounded-xl border p-3 text-sm ${tone.box} ${tone.text}`}>
          {a.icon && <span aria-hidden>{a.icon}</span>}
          <div className="min-w-0 space-y-0.5">
            {a.title && <div className="font-semibold">{a.title}</div>}
            <div>{kids(n.c)}</div>
          </div>
        </div>
      );
    }
    case "empty":
      return (
        <EmptyState key={key} icon={a.icon} title={a.title} text={a.text}>
          {n.c.length ? kids(n.c) : undefined}
        </EmptyState>
      );
    case "kv":
      return (
        <dl key={key} className="grid gap-x-6 gap-y-2 text-sm" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${Number(a.min) || 200}px, 1fr))` }}>
          {items(n).map((p, i) => (
            <div key={i} className="min-w-0">
              <dt className="text-xs font-medium text-zinc-500">{p.a.label}</dt>
              <dd className="min-w-0 break-words">{kids(p.c)}</dd>
            </div>
          ))}
        </dl>
      );
    case "avatar": {
      const size = Number(a.size) || 32;
      return a.src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a picture named by the template: from anywhere, no loader
        <img key={key} src={a.src} alt={a.name ?? ""} title={a.name} referrerPolicy="no-referrer" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
      ) : (
        <span key={key} title={a.name} className="inline-flex shrink-0 items-center justify-center rounded-full bg-indigo-100 font-semibold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" style={{ width: size, height: size, fontSize: size * 0.4 }}>
          {initials(a.name ?? "")}
        </span>
      );
    }
    case "quote":
      return (
        <figure key={key} className="border-l-2 border-indigo-400 pl-3 text-sm">
          <blockquote>{kids(n.c)}</blockquote>
          {a.cite && <figcaption className="mt-1 text-xs text-zinc-500">{a.cite}</figcaption>}
        </figure>
      );
    case "divider":
      return (
        <div key={key} className="flex items-center gap-3 text-xs font-medium text-zinc-500" role="separator">
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          {a.label}
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        </div>
      );
    case "progress": {
      const value = Number(a.value) || 0;
      const max = Number(a.max) || 100;
      const pct = Math.max(0, Math.min(100, (value / max) * 100));
      return (
        <div key={key} className="space-y-1">
          {(a.label || a.show === "true") && (
            <div className="flex justify-between gap-2 text-xs text-zinc-500">
              <span className="truncate">{a.label}</span>
              {a.show === "true" && <span className="tabular-nums">{Math.round(pct)} %</span>}
            </div>
          )}
          <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-label={a.label || undefined} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
            <div className={`h-full rounded-full transition-[width] ${(TONES[a.tone ?? ""] ?? TONES.info).bar}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      );
    }
    case "sparkline":
      return <Sparkline key={key} values={json<number[]>(a.data, [])} className={a.wide === "true" ? "h-10 w-full" : undefined} />;
    case "steps":
      return (
        <ol key={key} className="space-y-3 text-sm">
          {items(n).map((s, i) => (
            <li key={i} className="flex gap-3">
              <span aria-hidden className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.a.state === "done" ? "bg-emerald-600 text-white" : s.a.state === "active" ? "bg-indigo-600 text-white" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                {s.a.state === "done" ? "✓" : i + 1}
              </span>
              <div className="min-w-0">
                <div className={s.a.state === "active" ? "font-semibold" : "font-medium"}>{s.a.title}</div>
                {s.c.length > 0 && <div className="text-zinc-500">{kids(s.c)}</div>}
              </div>
            </li>
          ))}
        </ol>
      );
    case "gallery":
      return <Gallery key={key} n={n} kids={kids} env={env} />;
    case "timeline":
      return <Timeline key={key} n={n} kids={kids} />;
    case "board":
      return <Board key={key} n={n} kids={kids} env={env} />;
    case "facets":
      return <Facets key={key} a={a} env={env} />;
    case "quickadd":
      return <QuickAdd key={key} a={a} env={env} />;
    case "form":
      return <RowForm key={key} a={a} env={env} />;
    default:
      return undefined;
  }
}

/**
 * The panes as high as the window leaves below them, to its bottom edge (each pane scrolls by itself, the page doesn't): measured
 * where they start and what the page has below them, again when the window changes. Without a measure (print, a phone): the CSS's.
 */
function FillHeight({ className, style, children }: { className: string; style: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // What lies below the panes in their page — in a page the rest of the editor, on a database's own page its row count —, not
        // the sidebar beside it. (Phones, print: the CSS's height.)
        const page = el.closest(".ws-editor") ?? el.closest(".page > :not(.page-aside)");
        if (!page || !window.matchMedia("(min-width: 768px)").matches) return void el.style.removeProperty("height");
        const box = el.getBoundingClientRect();
        // (Its bottom with the panes as they are — and the window's own margin.)
        const end = page.getBoundingClientRect().bottom;
        const below = Math.max(0, end - box.bottom) + 16;
        // Measured in what scrolls (Zeff's main area, else the window) — as if it stood at its top, so a scrolled one fits too.
        const scroller = el.closest("main");
        const frame = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
        const top = box.top - frame.top + (scroller?.scrollTop ?? window.scrollY);
        el.style.height = `${Math.max(240, Math.min(window.innerHeight, frame.bottom) - frame.top - top - below)}px`;
      });
    };
    fit();
    window.addEventListener("resize", fit);
    const ro = new ResizeObserver(fit);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => (cancelAnimationFrame(frame), window.removeEventListener("resize", fit), ro.disconnect());
  }, []);
  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
