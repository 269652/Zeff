"use client";

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { confirmAction } from "@/components/confirm";
import { useT } from "@/components/I18nProvider";
import { databasesAction, saveFormAction } from "../actions";
import { COND_OPS, defaultAnswer, fieldItem, fieldLabel, formItemId, newStep, type CondOp, type FieldItem, type FormDef, type FormItem, type FormStep } from "../form-spec";
import type { FormRun } from "../forms";
import { PROP_LABELS, TITLE, type Property } from "../model";
import { FieldControl, StaticItem, StepProgress } from "./form-runner";

/**
 * The form designer (WYSIWYG): the palette on the left (the database's fields not on the form yet, a heading, a text, a divider —
 * dragged onto the canvas or added with their button), the canvas in the middle drawn as the form will look (its controls inert),
 * the selected part's settings on the right. Steps as tabs above the canvas (a wizard when there are several). Everything works by
 * keyboard too: canvas parts are focusable, Alt+↑/↓ moves one, Delete removes it, Enter selects it; moves are said in a live region.
 * Saved by itself a moment after each change.
 */

const MIME = "application/x-zeff-form";
type Drag = { kind: "move"; id: string } | { kind: "new"; item: FormItem };
type Sel = { kind: "form" } | { kind: "step" } | { kind: "item"; id: string };

// --- What the designer does to a form (pure) ---

const stepOf = (def: FormDef, id: string) => def.steps.findIndex((s) => s.items.some((i) => i.id === id));
const findItem = (def: FormDef, id: string): FormItem | undefined => def.steps.flatMap((s) => s.items).find((i) => i.id === id);
const withSteps = (def: FormDef, fn: (steps: FormStep[]) => FormStep[]): FormDef => ({ ...def, steps: fn(def.steps.map((s) => ({ ...s, items: [...s.items] }))) });

/** The item put at `index` of step `at` (taken from where it was, when it was on the form). */
function place(def: FormDef, item: FormItem, at: number, index: number): FormDef {
  return withSteps(def, (steps) => {
    const from = steps.findIndex((s) => s.items.some((i) => i.id === item.id));
    if (from >= 0) {
      const i = steps[from].items.findIndex((x) => x.id === item.id);
      steps[from].items.splice(i, 1);
      if (from === at && i < index) index--;
    }
    steps[at].items.splice(Math.max(0, Math.min(index, steps[at].items.length)), 0, item);
    return steps;
  });
}
const removeItem = (def: FormDef, id: string): FormDef => withSteps(def, (steps) => steps.map((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) })));
const patchItem = (def: FormDef, id: string, patch: Partial<FieldItem> | Partial<FormItem>): FormDef => withSteps(def, (steps) => steps.map((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? ({ ...i, ...patch } as FormItem) : i)) })));

export function FormDesigner({ initial, onChange }: { initial: FormRun; /** Told of each change (the page's preview draws it). */ onChange?: (f: FormRun) => void }) {
  const t = useT();
  const [form, setForm] = useState(initial);
  const def = form.def;
  const props = form.db?.props ?? [];
  const [at, setAt] = useState(0);
  const [sel, setSel] = useState<Sel>({ kind: "form" });
  const [over, setOver] = useState<{ step: number; index: number } | null>(null);
  const [said, setSaid] = useState("");
  const [status, setStatus] = useState<"" | "saving" | "saved" | "error">("");
  const [databases, setDatabases] = useState<{ id: number; title: string }[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(def);
  const canvas = useRef<HTMLDivElement>(null);
  const step = def.steps[Math.min(at, def.steps.length - 1)];

  useEffect(() => {
    void databasesAction().then((r) => r.ok && setDatabases(r.databases.map((d) => ({ id: d.id, title: d.title }))));
  }, []);
  // (Leaving the page with a change not yet saved: it goes now.)
  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      void saveFormAction(initial.id, latest.current);
    },
    [initial.id],
  );

  /** A change: drawn at once, saved a moment later (the last of quick changes only). */
  const change = (next: FormDef) => {
    latest.current = next;
    const f = { ...form, def: next };
    setForm(f);
    onChange?.(f);
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      timer.current = null;
      const r = await saveFormAction(form.id, latest.current);
      if (!r.ok) return setStatus("error");
      setStatus("saved");
      // The database's fields as the server has them (another database chosen); what was typed meanwhile stays.
      setForm((cur) => ({ ...cur, db: r.form.db }));
      onChange?.({ ...form, def: latest.current, db: r.form.db });
    }, 700);
  };

  const used = new Set(def.steps.flatMap((s) => s.items.filter((i): i is FieldItem => i.kind === "field").map((i) => i.prop)));
  const free = props.filter((p) => !used.has(p.id));
  const propOf = (id: string): Property | undefined => props.find((p) => p.id === id);
  const nameOf = (i: FormItem): string => (i.kind === "field" ? fieldLabel(i, propOf(i.prop)) : i.kind === "heading" ? i.text || t("Heading") : i.kind === "text" ? t("Text") : t("Divider"));
  const focusItem = (id: string) => requestAnimationFrame(() => canvas.current?.querySelector<HTMLElement>(`[data-item="${id}"]`)?.focus());

  const add = (item: FormItem, index = step.items.length) => {
    change(place(def, item, at, index));
    setSel({ kind: "item", id: item.id });
    setSaid(t("{name} added to the form.", { name: nameOf(item) }));
    focusItem(item.id);
  };
  const move = (id: string, by: number) => {
    const s = stepOf(def, id);
    const i = def.steps[s].items.findIndex((x) => x.id === id);
    const to = i + by;
    if (to < 0 || to >= def.steps[s].items.length) return;
    change(
      withSteps(def, (steps) => {
        const [it] = steps[s].items.splice(i, 1);
        steps[s].items.splice(to, 0, it);
        return steps;
      }),
    );
    setSaid(t("{name} moved to position {n} of {total}.", { name: nameOf(def.steps[s].items[i]), n: to + 1, total: def.steps[s].items.length }));
    focusItem(id);
  };
  const remove = (id: string) => {
    const s = stepOf(def, id);
    const items = def.steps[s]?.items ?? [];
    const i = items.findIndex((x) => x.id === id);
    const item = items[i];
    if (!item) return;
    change(removeItem(def, id));
    setSel({ kind: "form" });
    setSaid(t("{name} removed from the form.", { name: nameOf(item) }));
    const nextId = items[i + 1]?.id ?? items[i - 1]?.id;
    if (nextId) focusItem(nextId);
  };
  const toStep = (id: string, target: number) => {
    const item = findItem(def, id);
    if (!item) return;
    change(place(def, item, target, def.steps[target].items.length));
    setAt(target);
    setSaid(t("{name} moved to step {n}.", { name: nameOf(item), n: target + 1 }));
  };

  // --- Drag and drop: the palette's parts and the canvas's, onto the canvas (where the line shows) or onto a step's tab ---
  const drag = (d: Drag) => (e: DragEvent) => {
    e.dataTransfer.setData(MIME, JSON.stringify(d));
    e.dataTransfer.effectAllowed = d.kind === "move" ? "move" : "copy";
  };
  const read = (e: DragEvent): Drag | null => {
    try {
      return JSON.parse(e.dataTransfer.getData(MIME)) as Drag;
    } catch {
      return null;
    }
  };
  const dropAt = (e: DragEvent, stepIndex: number, index: number) => {
    const d = read(e);
    setOver(null);
    if (!d) return;
    e.preventDefault();
    if (d.kind === "new") {
      // (A new item gets its own id at the drop: the same palette part dropped twice is two items.)
      const item = { ...d.item, id: formItemId() } as FormItem;
      if (item.kind === "field" && used.has(item.prop)) return;
      change(place(def, item, stepIndex, index));
      setSel({ kind: "item", id: item.id });
      setSaid(t("{name} added to the form.", { name: nameOf(item) }));
    } else {
      const item = findItem(def, d.id);
      if (!item) return;
      change(place(def, item, stepIndex, index));
      setSaid(t("{name} moved.", { name: nameOf(item) }));
    }
  };
  const overItem = (index: number, half: boolean) => (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const after = half ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    const target = { step: at, index: index + (after ? 1 : 0) };
    setOver((o) => (o && o.step === target.step && o.index === target.index ? o : target));
  };
  /** The insertion line on a canvas part: before it (top, or left for a half), or after the last one. */
  const line = (index: number, half: boolean): string => {
    if (over?.step !== at) return "";
    if (over.index === index) return half ? "shadow-[inset_4px_0_0_0_#6366f1]" : "shadow-[inset_0_4px_0_0_#6366f1]";
    if (over.index === index + 1 && half) return "shadow-[inset_-4px_0_0_0_#6366f1]";
    return "";
  };

  const keys = (id: string) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      move(id, e.key === "ArrowUp" ? -1 : 1);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(id);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSel({ kind: "item", id });
    }
  };

  // --- Steps ---
  const addStep = () => {
    change({ ...def, steps: [...def.steps, newStep(t("Step {n}", { n: def.steps.length + 1 }))] });
    setAt(def.steps.length);
    setSel({ kind: "step" });
  };
  const moveStep = (by: number) => {
    const to = at + by;
    if (to < 0 || to >= def.steps.length) return;
    change(
      withSteps(def, (steps) => {
        const [s] = steps.splice(at, 1);
        steps.splice(to, 0, s);
        return steps;
      }),
    );
    setAt(to);
    setSaid(t("Step moved to position {n}.", { n: to + 1 }));
  };
  const deleteStep = () => {
    if (def.steps.length < 2) return;
    if (step.items.length && !confirmAction(t("Delete this step? Its parts move to the step before it."))) return;
    const into = at > 0 ? at - 1 : 1;
    change(
      withSteps(def, (steps) => {
        steps[into].items.push(...steps[at].items);
        steps.splice(at, 1);
        return steps;
      }),
    );
    setAt(Math.max(0, at - 1));
    setSel({ kind: "form" });
  };

  const chooseDb = (dbId: number | null) => {
    if (dbId === def.dbId) return;
    if (def.dbId && def.steps.some((s) => s.items.some((i) => i.kind === "field")) && !confirmAction(t("Fill another database? The fields of this one leave the form."))) return;
    const steps: FormStep[] = def.steps.map((s) => ({ ...s, items: s.items.filter((i) => i.kind !== "field") }));
    if (dbId) steps[0] = { ...steps[0], items: [fieldItem(TITLE, { required: true }), ...steps[0].items] };
    change({ ...def, dbId, steps });
  };

  const selected = sel.kind === "item" ? findItem(def, sel.id) : undefined;
  const pal = "flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_19rem]">
      <div role="status" aria-live="polite" className="sr-only">
        {said}
      </div>

      {/* The palette */}
      <aside aria-label={t("Parts of the form")} className="space-y-4 text-sm">
        <section className="space-y-1.5">
          <label htmlFor={`fd-db-${form.id}`} className="block text-sm font-medium">
            {t("Database it fills")}
          </label>
          <select id={`fd-db-${form.id}`} className="input" value={def.dbId ?? ""} onChange={(e) => chooseDb(Number(e.target.value) || null)}>
            <option value="">{t("Choose a database …")}</option>
            {databases.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          {def.dbId && !form.db && status !== "saving" && <p className="text-xs text-amber-700 dark:text-amber-400">{t("That database is gone (in the trash?).")}</p>}
        </section>
        {form.db && (
          <section className="space-y-1.5">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase">{t("Fields")}</h2>
            {free.length ? (
              <ul className="space-y-1">
                {free.map((p) => (
                  <li key={p.id} className={`${pal} cursor-grab`} draggable onDragStart={drag({ kind: "new", item: fieldItem(p.id, p.id === TITLE ? { required: true } : {}) })}>
                    <span aria-hidden="true" className="text-zinc-400">
                      ⠿
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {p.name}
                      <span className="block text-xs text-zinc-500">{p.id === TITLE ? t("Title") : t(PROP_LABELS[p.type])}</span>
                    </span>
                    <button type="button" className="icon-btn" aria-label={t("Add {name} to the form", { name: p.name })} title={t("Add")} onClick={() => add(fieldItem(p.id, p.id === TITLE ? { required: true } : {}))}>
                      ＋
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-500">{t("Every field is on the form.")}</p>
            )}
          </section>
        )}
        <section className="space-y-1.5">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase">{t("Layout")}</h2>
          <ul className="space-y-1">
            {(
              [
                ["heading", "H", t("Heading"), (): FormItem => ({ id: formItemId(), kind: "heading", text: t("Heading") })],
                ["text", "¶", t("Text"), (): FormItem => ({ id: formItemId(), kind: "text", text: t("Some words for the people filling it in.") })],
                ["divider", "—", t("Divider"), (): FormItem => ({ id: formItemId(), kind: "divider" })],
              ] as const
            ).map(([k, icon, label, make]) => (
              <li key={k} className={`${pal} cursor-grab`} draggable onDragStart={drag({ kind: "new", item: make() })}>
                <span aria-hidden="true" className="w-4 text-center text-zinc-400">
                  {icon}
                </span>
                <span className="flex-1">{label}</span>
                <button type="button" className="icon-btn" aria-label={t("Add {name} to the form", { name: label })} title={t("Add")} onClick={() => add(make())}>
                  ＋
                </button>
              </li>
            ))}
          </ul>
        </section>
        <p className="text-xs text-zinc-500">{t("Drag parts onto the form, or use ＋. On the form: Alt+↑/↓ moves the selected part, Delete removes it.")}</p>
      </aside>

      {/* The canvas */}
      <section aria-label={t("The form")} className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("Steps")}>
          {def.steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-current={i === at ? "step" : undefined}
              className={`rounded-md border px-2.5 py-1 text-sm ${i === at ? "border-indigo-500 bg-indigo-50 font-medium dark:bg-indigo-950" : "border-zinc-200 dark:border-zinc-700"} ${over && over.step === i && i !== at ? "ring-2 ring-indigo-500" : ""}`}
              onClick={() => (setAt(i), setSel({ kind: "step" }))}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(MIME)) return;
                e.preventDefault();
                setOver({ step: i, index: def.steps[i].items.length });
              }}
              onDrop={(e) => dropAt(e, i, def.steps[i].items.length)}
            >
              {i + 1}. {s.title || t("Step {n}", { n: i + 1 })}
            </button>
          ))}
          <button type="button" className="btn btn-sm" onClick={addStep}>
            ＋ {t("Step")}
          </button>
          <span className="ml-auto text-xs text-zinc-500">{status === "saving" ? t("Saving …") : status === "saved" ? t("Saved") : status === "error" ? t("Not saved") : ""}</span>
        </div>

        <div className="card space-y-4 p-5">
          <button type="button" aria-pressed={sel.kind === "form"} className={`block w-full rounded-md p-1 text-left ${sel.kind === "form" ? "ring-2 ring-indigo-500" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`} onClick={() => setSel({ kind: "form" })} title={t("Form settings: title, introduction, button, thanks")}>
            <span className="block text-2xl font-semibold">{def.title || form.title || t("Form")}</span>
            {def.intro && <span className="mt-1 block text-sm whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">{def.intro}</span>}
          </button>
          <StepProgress at={at} of={def.steps.length} title={step.title} />
          <div
            ref={canvas}
            className="grid min-h-24 grid-cols-1 gap-3 sm:grid-cols-2"
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(MIME)) return;
              e.preventDefault();
              if (e.target === e.currentTarget) setOver({ step: at, index: step.items.length });
            }}
            onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(null)}
            onDrop={(e) => dropAt(e, at, over?.step === at ? over.index : step.items.length)}
          >
            {step.items.map((item, index) => {
              const half = item.kind === "field" && item.width === "half";
              const prop = item.kind === "field" ? propOf(item.prop) : undefined;
              const isSel = sel.kind === "item" && sel.id === item.id;
              const notes = item.kind === "field" ? [item.required ? t("required") : "", item.hidden ? t("not asked") : "", item.when ? t("conditional") : "", form.db && !prop ? t("field is gone") : ""].filter(Boolean) : [];
              return (
                <div
                  key={item.id}
                  data-item={item.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSel}
                  aria-label={`${nameOf(item)}${notes.length ? ` (${notes.join(", ")})` : ""} — ${t("position {n} of {total}", { n: index + 1, total: step.items.length })}`}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Delete Enter"
                  draggable
                  onDragStart={drag({ kind: "move", id: item.id })}
                  onDragEnd={() => setOver(null)}
                  onDragOver={overItem(index, half)}
                  onDrop={(e) => {
                    e.stopPropagation();
                    dropAt(e, at, over?.step === at ? over.index : index);
                  }}
                  onClick={() => setSel({ kind: "item", id: item.id })}
                  onKeyDown={keys(item.id)}
                  className={`group relative cursor-grab rounded-md p-2 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${half ? "" : "sm:col-span-2"} ${isSel ? "bg-indigo-50/60 ring-2 ring-indigo-500 dark:bg-indigo-950/40" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"} ${item.kind === "field" && (item.hidden || item.when) ? "border border-dashed border-zinc-300 dark:border-zinc-600" : ""} ${line(index, half)}`}
                >
                  {notes.length > 0 && (
                    <span className="absolute top-1 right-2 text-[11px] text-zinc-500" aria-hidden="true">
                      {notes.join(" · ")}
                    </span>
                  )}
                  <div inert className="pointer-events-none">
                    {item.kind !== "field" ? <StaticItem item={item} /> : prop ? <FieldControl item={item} prop={prop} value={defaultAnswer(prop, item.default)} onChange={() => undefined} uid={`fd${form.id}`} /> : <p className="text-sm text-zinc-500">{item.prop}</p>}
                  </div>
                </div>
              );
            })}
            {!step.items.length && <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 sm:col-span-2 dark:border-zinc-700">{form.db ? t("Drag fields here, or add them with ＋.") : t("Choose the database this form fills first.")}</p>}
            {over?.step === at && over.index === step.items.length && step.items.length > 0 && <div className="h-1 rounded bg-indigo-500 sm:col-span-2" aria-hidden="true" />}
          </div>
          <div inert className="flex gap-2">
            {at > 0 && <span className="btn">← {t("Back")}</span>}
            <span className="btn btn-primary">{at < def.steps.length - 1 ? `${t("Next")} →` : def.submitLabel || t("Send")}</span>
          </div>
        </div>
      </section>

      {/* The inspector */}
      <aside aria-label={t("Settings of the selected part")} className="space-y-3 text-sm">
        {sel.kind === "form" && (
          <>
            <h2 className="font-semibold">{t("The form")}</h2>
            <Text label={t("Title")} value={def.title} placeholder={form.title} onChange={(v) => change({ ...def, title: v })} />
            <Text label={t("Introduction")} value={def.intro} area onChange={(v) => change({ ...def, intro: v })} />
            <Text label={t("Button text")} value={def.submitLabel} placeholder={t("Send")} onChange={(v) => change({ ...def, submitLabel: v })} />
            <Text label={t("Message after sending")} value={def.thanks} placeholder={t("Thank you — it is saved.")} area onChange={(v) => change({ ...def, thanks: v })} />
            <p className="text-xs text-zinc-500">{t("Anyone who can open this Zeff (and is signed in to it) can fill it in.")}</p>
          </>
        )}
        {sel.kind === "step" && (
          <>
            <h2 className="font-semibold">{t("Step {n}", { n: at + 1 })}</h2>
            <Text label={t("Title of the step")} value={step.title} onChange={(v) => change(withSteps(def, (steps) => ((steps[at] = { ...steps[at], title: v }), steps)))} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-sm" disabled={at === 0} onClick={() => moveStep(-1)}>
                ← {t("Earlier")}
              </button>
              <button type="button" className="btn btn-sm" disabled={at >= def.steps.length - 1} onClick={() => moveStep(1)}>
                {t("Later")} →
              </button>
              <button type="button" className="btn btn-sm btn-danger" disabled={def.steps.length < 2} onClick={deleteStep}>
                {t("Delete the step")}
              </button>
            </div>
            <p className="text-xs text-zinc-500">{t("Several steps make a wizard: each step is checked before the next one.")}</p>
          </>
        )}
        {selected && (
          <ItemInspector
            key={selected.id}
            item={selected}
            def={def}
            props={props}
            stepIndex={stepOf(def, selected.id)}
            onPatch={(p) => change(patchItem(def, selected.id, p))}
            onRemove={() => remove(selected.id)}
            onMove={(by) => move(selected.id, by)}
            onStep={(s) => toStep(selected.id, s)}
          />
        )}
      </aside>
    </div>
  );
}

function Text({ label, value, onChange, placeholder, area = false }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; area?: boolean }) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-medium">{label}</span>
      {area ? <textarea className="input" rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /> : <input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

/** A default as it is kept (words): a choice's id, several by commas, a tick as "true". */
const asDefault = (v: unknown): string => (Array.isArray(v) ? v.join(",") : v === true ? "true" : v === false ? "" : String(v ?? ""));

/** The settings of one part of the form: a field's words, required / not asked (with its value), width, condition, step. */
function ItemInspector({ item, def, props, stepIndex, onPatch, onRemove, onMove, onStep }: { item: FormItem; def: FormDef; props: Property[]; stepIndex: number; onPatch: (p: Partial<FieldItem> | Partial<FormItem>) => void; onRemove: () => void; onMove: (by: number) => void; onStep: (s: number) => void }) {
  const t = useT();
  const prop = item.kind === "field" ? props.find((p) => p.id === item.prop) : undefined;
  const others = def.steps.flatMap((s) => s.items).filter((i): i is FieldItem => i.kind === "field" && i.id !== item.id);
  const opNames: Record<CondOp, string> = { eq: t("is"), neq: t("is not"), contains: t("contains"), filled: t("is filled"), empty: t("is empty") };
  return (
    <>
      <h2 className="font-semibold">{item.kind === "field" ? (prop?.name ?? item.prop) : item.kind === "heading" ? t("Heading") : item.kind === "text" ? t("Text") : t("Divider")}</h2>
      {(item.kind === "heading" || item.kind === "text") && <Text label={item.kind === "heading" ? t("Heading") : t("Text")} value={item.text} area={item.kind === "text"} onChange={(v) => onPatch({ text: v })} />}
      {item.kind === "field" && (
        <>
          <Text label={t("Label")} value={item.label ?? ""} placeholder={prop?.name} onChange={(v) => onPatch({ label: v || undefined })} />
          <Text label={t("Help text")} value={item.help ?? ""} onChange={(v) => onPatch({ help: v || undefined })} />
          {prop && !["checkbox", "multi_select", "date"].includes(prop.type) && <Text label={t("Placeholder")} value={item.placeholder ?? ""} onChange={(v) => onPatch({ placeholder: v || undefined })} />}
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-indigo-600" checked={!!item.required} disabled={!!item.hidden} onChange={(e) => onPatch({ required: e.target.checked ? true : undefined })} />
            {t("Required")}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-indigo-600" checked={!!item.hidden} onChange={(e) => onPatch({ hidden: e.target.checked ? true : undefined, ...(e.target.checked ? { required: undefined } : {}) })} />
            {t("Not asked — its value is set on every entry")}
          </label>
          {prop && (
            <div className="space-y-1 rounded-md bg-zinc-50 p-2 dark:bg-zinc-900">
              <p className="text-xs text-zinc-500">{item.hidden ? t("The value set:") : t("Prefilled with:")}</p>
              <FieldControl item={{ ...item, label: t("Default of {field}", { field: fieldLabel(item, prop) }), help: undefined, required: undefined }} prop={prop} value={defaultAnswer(prop, item.default)} onChange={(v) => onPatch({ default: asDefault(v) || undefined })} uid={`fi-${item.id}`} dbId={def.dbId ?? undefined} />
            </div>
          )}
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t("Width")}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {(["full", "half"] as const).map((w) => (
                <label key={w} className="flex items-center gap-1.5">
                  <input type="radio" name={`w-${item.id}`} className="accent-indigo-600" checked={item.width === w} onChange={() => onPatch({ width: w })} />
                  {w === "full" ? t("Full width") : t("Half (two side by side)")}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">{t("Show only if")}</legend>
            <Condition item={item} others={others} props={props} opNames={opNames} onPatch={onPatch} />
          </fieldset>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <button type="button" className="btn btn-sm" onClick={() => onMove(-1)} aria-label={t("Move up")} title={t("Move up")}>
          ↑
        </button>
        <button type="button" className="btn btn-sm" onClick={() => onMove(1)} aria-label={t("Move down")} title={t("Move down")}>
          ↓
        </button>
        {def.steps.length > 1 && (
          <select className="input w-auto py-1 text-xs" value={stepIndex} aria-label={t("Move to step")} onChange={(e) => onStep(Number(e.target.value))}>
            {def.steps.map((s, i) => (
              <option key={s.id} value={i}>
                {t("Step {n}", { n: i + 1 })}
                {s.title ? ` — ${s.title}` : ""}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="btn btn-sm btn-danger ml-auto" onClick={onRemove}>
          {t("Remove")}
        </button>
      </div>
    </>
  );
}

/** "Show only if [field] [is / is not / contains / is filled / is empty] [value]" — a choice's value picked among its options. */
function Condition({ item, others, props, opNames, onPatch }: { item: FieldItem; others: FieldItem[]; props: Property[]; opNames: Record<CondOp, string>; onPatch: (p: Partial<FieldItem>) => void }) {
  const t = useT();
  const w = item.when;
  const ref = w ? props.find((p) => p.id === w.prop) : undefined;
  const needsValue = !!w && w.op !== "filled" && w.op !== "empty";
  const pick = needsValue && w.op !== "contains" && (ref?.type === "checkbox" || !!ref?.options?.length);
  return (
    <div className="space-y-1.5">
      <select className="input" value={w?.prop ?? ""} aria-label={t("Field the condition looks at")} onChange={(e) => onPatch({ when: e.target.value ? { prop: e.target.value, op: w?.op ?? "eq", value: "" } : undefined })}>
        <option value="">{t("— always shown —")}</option>
        {others.map((f) => (
          <option key={f.id} value={f.prop}>
            {fieldLabel(f, props.find((p) => p.id === f.prop))}
          </option>
        ))}
      </select>
      {w && (
        <select className="input" value={w.op} aria-label={t("Condition")} onChange={(e) => onPatch({ when: { ...w, op: e.target.value as CondOp } })}>
          {COND_OPS.map((o) => (
            <option key={o} value={o}>
              {opNames[o]}
            </option>
          ))}
        </select>
      )}
      {w && pick && ref ? (
        <select className="input" value={w.value ?? ""} aria-label={t("Value")} onChange={(e) => onPatch({ when: { ...w, value: e.target.value } })}>
          <option value="">—</option>
          {ref.type === "checkbox"
            ? [
                ["true", t("ticked")],
                ["false", t("not ticked")],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))
            : (ref.options ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
        </select>
      ) : w && needsValue ? (
        <input className="input" value={w.value ?? ""} aria-label={t("Value")} onChange={(e) => onPatch({ when: { ...w, value: e.target.value } })} />
      ) : null}
    </div>
  );
}
