"use client";

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { confirmAction } from "@/components/confirm";
import { useT } from "@/components/I18nProvider";
import { addFormFieldAction, databasesAction, saveFormAction } from "../actions";
import { COND_OPS, defaultAnswer, fieldItem, fieldLabel, fieldsIn, formItemId, newRowsItem, newStep, ROWS_COL_TYPES, ROWS_MAX_COLS, rowsCols, type CondOp, type FieldItem, type FlexItem, type FormDef, type FormItem, type FormStep, type RowsItem } from "../form-spec";
import { canPlace, findPart, freshIds, newBox, partsOf, patchPart, placePart, removePart, spotOf } from "../form-tree";
import type { FormRun } from "../forms";
import { PROP_LABELS, TITLE, type Property, type PropType } from "../model";
import { FieldControl, flexChildClass, flexClass, RowsField, StaticItem, StepProgress } from "./form-runner";

/**
 * The form designer (WYSIWYG): the palette on the left (the database's fields not on the form yet, a heading, a text, a divider, a
 * row and a column — dragged onto the canvas or added with their button), the canvas in the middle drawn as the form will look (its
 * controls inert; rows and columns tinted, with a dashed edge), the selected part's settings on the right. Steps as tabs above the
 * canvas (a wizard when there are several). Everything works by keyboard too: canvas parts are focusable, Alt+↑/↓ moves one within
 * its box, Alt+→ puts it into the box after it, Alt+← takes it out of its box, Delete removes it, Enter selects it; each move is
 * said in a live region. Saved by itself a moment after each change.
 */

const MIME = "application/x-zeff-form";
type Drag = { kind: "move"; id: string } | { kind: "new"; item: FormItem };
type Sel = { kind: "form" } | { kind: "step" } | { kind: "item"; id: string };
/** Where a drop would land: the list of `owner` (a step's or a box's id), at `index`. */
type Over = { owner: string; index: number };

export function FormDesigner({ initial, onChange }: { initial: FormRun; /** Told of each change (the page's preview draws it). */ onChange?: (f: FormRun) => void }) {
  const t = useT();
  const [form, setForm] = useState(initial);
  const def = form.def;
  const props = form.db?.props ?? [];
  const [at, setAt] = useState(0);
  const [sel, setSel] = useState<Sel>({ kind: "form" });
  const [over, setOver] = useState<Over | null>(null);
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
      setForm((cur) => ({ ...cur, db: r.form.db, rows: r.form.rows }));
      onChange?.({ ...form, def: latest.current, db: r.form.db, rows: r.form.rows });
    }, 700);
  };

  const used = new Set(def.steps.flatMap((s) => fieldsIn(s.items).map((i) => i.prop)));
  const free = props.filter((p) => !used.has(p.id));
  const propOf = (id: string): Property | undefined => props.find((p) => p.id === id);
  const boxName = (b: Pick<FlexItem, "dir">) => (b.dir === "row" ? t("Row") : t("Column"));
  const nameOf = (i: FormItem): string => (i.kind === "field" ? fieldLabel(i, propOf(i.prop)) : i.kind === "heading" ? i.text || t("Heading") : i.kind === "text" ? t("Text") : i.kind === "flex" ? boxName(i) : i.kind === "rows" ? i.label || t("Rows of the database") : t("Divider"));
  /**
   * A rows item put on a form whose only field is the title it started with (untouched): that field goes — such a form changes rows,
   * it makes none, and an empty title would stop it. Said in the live region.
   */
  const withoutBareTitle = (next: FormDef, item: FormItem): FormDef => {
    const fields = next.steps.flatMap((x) => fieldsIn(x.items));
    const only = fields.length === 1 ? fields[0] : undefined;
    if (item.kind !== "rows" || !only || only.prop !== TITLE || only.label || only.help || only.placeholder || only.hidden || only.default || only.when) return next;
    setTimeout(() => setSaid(t("The title field was taken off: this form changes the rows, it makes no new one.")), 600);
    return removePart(next, only.id);
  };
  const focusItem = (id: string) => requestAnimationFrame(() => canvas.current?.querySelector<HTMLElement>(`[data-item="${id}"]`)?.focus());
  // A box selected: what is added goes into it; else to the end of the step.
  const selBox = sel.kind === "item" ? findPart(def, sel.id) : undefined;
  const target = selBox?.kind === "flex" && spotOf(def, selBox.id)?.step === at ? selBox.id : step.id;

  const add = (item: FormItem) => {
    const owner = canPlace(def, item, target) ? target : step.id;
    change(withoutBareTitle(placePart(def, item, owner, partsOf(def, owner)?.length ?? 0), item));
    setSel({ kind: "item", id: item.id });
    setSaid(owner === step.id ? t("{name} added to the form.", { name: nameOf(item) }) : t("{name} added to the {box}.", { name: nameOf(item), box: nameOf(findPart(def, owner)!) }));
    focusItem(item.id);
  };
  const move = (id: string, by: number) => {
    const s = spotOf(def, id);
    const list = s && partsOf(def, s.owner);
    if (!s || !list) return;
    const to = s.index + by;
    if (to < 0 || to >= list.length) return;
    change(placePart(def, list[s.index], s.owner, by > 0 ? to + 1 : to));
    setSaid(t("{name} moved to position {n} of {total}.", { name: nameOf(list[s.index]), n: to + 1, total: list.length }));
    focusItem(id);
  };
  /** Into the box right after it (Alt+→), at its start — or out of its box (Alt+←), right after that box. */
  const shift = (id: string, into: boolean) => {
    const s = spotOf(def, id);
    const list = s && partsOf(def, s.owner);
    const item = list?.[s!.index];
    if (!s || !list || !item) return;
    if (into) {
      const box = list.slice(s.index + 1).find((i): i is FlexItem => i.kind === "flex");
      if (!box || !canPlace(def, item, box.id)) return setSaid(t("No box after {name} to put it in.", { name: nameOf(item) }));
      change(placePart(def, item, box.id, 0));
      setSaid(t("{name} moved into the {box}.", { name: nameOf(item), box: nameOf(box) }));
    } else {
      const parent = spotOf(def, s.owner);
      if (!parent) return setSaid(t("{name} is not in a box.", { name: nameOf(item) }));
      change(placePart(def, item, parent.owner, parent.index + 1));
      setSaid(t("{name} moved out of the {box}.", { name: nameOf(item), box: nameOf(findPart(def, s.owner)!) }));
    }
    focusItem(id);
  };
  const remove = (id: string) => {
    const s = spotOf(def, id);
    const list = s && partsOf(def, s.owner);
    const item = list?.[s!.index];
    if (!s || !list || !item) return;
    // A box goes, what is in it stays — in its place.
    change(removePart(def, id, true));
    setSel({ kind: "form" });
    setSaid(item.kind === "flex" && item.items.length ? t("{name} removed — its parts stay in its place.", { name: nameOf(item) }) : t("{name} removed from the form.", { name: nameOf(item) }));
    const nextId = (item.kind === "flex" ? item.items[0]?.id : undefined) ?? list[s.index + 1]?.id ?? list[s.index - 1]?.id;
    if (nextId) focusItem(nextId);
  };
  const toStep = (id: string, targetStep: number) => {
    const item = findPart(def, id);
    if (!item) return;
    change(placePart(def, item, def.steps[targetStep].id, def.steps[targetStep].items.length));
    setAt(targetStep);
    setSaid(t("{name} moved to step {n}.", { name: nameOf(item), n: targetStep + 1 }));
  };

  // --- Drag and drop: the palette's parts and the canvas's, onto a list (where the line shows) or onto a step's tab ---
  const drag = (d: Drag) => (e: DragEvent) => {
    e.stopPropagation();
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
  const dropAt = (e: DragEvent, owner: string, index: number) => {
    e.stopPropagation();
    const d = read(e);
    setOver(null);
    if (!d) return;
    e.preventDefault();
    // (A new part gets its own ids at the drop: the same palette part dropped twice is two parts.)
    const item = d.kind === "new" ? freshIds(d.item, formItemId) : findPart(def, d.id);
    if (!item || (item.kind === "field" && d.kind === "new" && used.has(item.prop))) return;
    if (!canPlace(def, item, owner)) return setSaid(t("It can't go there (boxes nest {n} deep at most).", { n: 3 }));
    change(d.kind === "new" ? withoutBareTitle(placePart(def, item, owner, index), item) : placePart(def, item, owner, index));
    if (d.kind === "new") setSel({ kind: "item", id: item.id });
    setSaid(d.kind === "new" ? t("{name} added to the form.", { name: nameOf(item) }) : t("{name} moved.", { name: nameOf(item) }));
  };
  const hover = (e: DragEvent, o: Over) => {
    if (!e.dataTransfer.types.includes(MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    setOver((cur) => (cur && cur.owner === o.owner && cur.index === o.index ? cur : o));
  };
  /** Over a part: before or after it in its list (left/right in a row or for a half-width field, else above/below). */
  const overPart = (owner: string, index: number, across: boolean) => (e: DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const after = across ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    hover(e, { owner, index: index + (after ? 1 : 0) });
  };
  const line = (owner: string, index: number, across: boolean): string => (over?.owner !== owner || over.index !== index ? "" : across ? "shadow-[inset_4px_0_0_0_#6366f1]" : "shadow-[inset_0_4px_0_0_#6366f1]");

  const keys = (id: string) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      move(id, e.key === "ArrowUp" ? -1 : 1);
    } else if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      shift(id, e.key === "ArrowRight");
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(id);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSel({ kind: "item", id });
    }
  };

  /** One part on the canvas — a box with its own list inside. `across`: its list lays parts side by side (a row). */
  const part = (item: FormItem, owner: string, index: number, total: number, inRow: boolean, top: boolean): ReactNode => {
    const isSel = sel.kind === "item" && sel.id === item.id;
    const pos = t("position {n} of {total}", { n: index + 1, total });
    const handle = {
      "data-item": item.id,
      role: "button",
      tabIndex: 0,
      "aria-pressed": isSel,
      "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown Alt+ArrowRight Alt+ArrowLeft Delete Enter",
      draggable: true,
      onDragStart: drag({ kind: "move", id: item.id }),
      onDragEnd: () => setOver(null),
      onClick: (e: { stopPropagation: () => void }) => (e.stopPropagation(), setSel({ kind: "item", id: item.id })),
      onKeyDown: keys(item.id),
    } as const;
    const ring = isSel ? "ring-2 ring-indigo-500" : "";
    if (item.kind === "flex") {
      const across = item.dir === "row";
      return (
        <div
          key={item.id}
          role="group"
          aria-label={boxName(item)}
          className={`rounded-md border border-dashed p-2 ${across ? "border-indigo-300 bg-indigo-500/[0.04] dark:border-indigo-800" : "border-zinc-300 bg-zinc-500/[0.05] dark:border-zinc-600"} ${top ? "@md:col-span-2" : ""} ${inRow ? flexChildClass({ dir: "row" }) : ""} ${ring} ${line(owner, index, inRow)}`}
          onDragOver={overPart(owner, index, inRow)}
          onDrop={(e) => dropAt(e, owner, over?.owner === owner ? over.index : index)}
        >
          <div {...handle} aria-label={`${boxName(item)}, ${t("{n} parts", { n: item.items.length })} — ${pos}`} className="mb-1 flex cursor-grab items-center gap-1 rounded px-1 text-[11px] font-medium text-zinc-500 outline-none select-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <span aria-hidden="true">⠿ {across ? "⇢" : "⇣"}</span> {boxName(item)}
          </div>
          {list(item.id, item.items, across, false, item)}
        </div>
      );
    }
    const half = item.kind === "field" && item.width === "half";
    const prop = item.kind === "field" ? propOf(item.prop) : undefined;
    const notes = item.kind === "field" ? [item.required ? t("required") : "", item.hidden ? t("not asked") : "", item.when ? t("conditional") : "", form.db && !prop ? t("field is gone") : ""].filter(Boolean) : [];
    return (
      <div
        key={item.id}
        {...handle}
        aria-label={`${nameOf(item)}${notes.length ? ` (${notes.join(", ")})` : ""} — ${pos}`}
        onDragOver={overPart(owner, index, inRow || (top && half))}
        onDrop={(e) => dropAt(e, owner, over?.owner === owner ? over.index : index)}
        className={`group relative cursor-grab rounded-md p-2 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${top && !half ? "@md:col-span-2" : ""} ${inRow ? flexChildClass({ dir: "row" }) : ""} ${isSel ? "bg-indigo-50/60 ring-2 ring-indigo-500 dark:bg-indigo-950/40" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"} ${item.kind === "field" && (item.hidden || item.when) ? "border border-dashed border-zinc-300 dark:border-zinc-600" : ""} ${line(owner, index, inRow || (top && half))}`}
      >
        {notes.length > 0 && (
          <span className="absolute top-1 right-2 text-[11px] text-zinc-500" aria-hidden="true">
            {notes.join(" · ")}
          </span>
        )}
        <div inert className="pointer-events-none">
          {item.kind === "rows" ? (
            form.db ? <RowsField item={item} db={form.db} rows={form.rows ?? []} edits={{}} onEdit={() => undefined} uid={`fd${form.id}`} /> : <p className="text-sm text-zinc-500">{t("Rows of the database")}</p>
          ) : item.kind !== "field" ? <StaticItem item={item} /> : prop ? <FieldControl item={item} prop={prop} value={defaultAnswer(prop, item.default)} onChange={() => undefined} uid={`fd${form.id}`} /> : <p className="text-sm text-zinc-500">{item.prop}</p>}
        </div>
      </div>
    );
  };

  /** A list of parts — the step's (a two-column grid) or a box's (its own layout) — with the line where a drop would land at its end. */
  function list(owner: string, items: FormItem[], across: boolean, top: boolean, box?: FlexItem): ReactNode {
    const end = over?.owner === owner && over.index === items.length;
    return (
      <div
        ref={top ? canvas : undefined}
        className={top ? "grid min-h-24 grid-cols-1 gap-3 @md:grid-cols-2" : `${flexClass(box!)} min-h-12`}
        onDragOver={(e) => e.target === e.currentTarget && hover(e, { owner, index: items.length })}
        onDragLeave={(e) => top && !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(null)}
        onDrop={(e) => dropAt(e, owner, over?.owner === owner ? over.index : items.length)}
      >
        {items.map((item, i) => part(item, owner, i, items.length, across, top))}
        {!items.length &&
          (top ? (
            <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 @md:col-span-2 dark:border-zinc-700">{form.db ? t("Drag fields here, or add them with ＋.") : t("Choose the database this form fills first.")}</p>
          ) : (
            <p className={`flex-1 rounded p-2 text-center text-xs text-zinc-400 ${end ? "ring-2 ring-indigo-500" : ""}`} onDragOver={(e) => hover(e, { owner, index: 0 })}>
              {t("Drop parts here")}
            </p>
          ))}
        {end && items.length > 0 && <div className={across ? "w-1 self-stretch rounded bg-indigo-500" : `h-1 rounded bg-indigo-500 ${top ? "@md:col-span-2" : ""}`} aria-hidden="true" />}
      </div>
    );
  }

  // --- Steps ---
  const withSteps = (fn: (steps: FormStep[]) => FormStep[]): FormDef => ({ ...def, steps: fn(def.steps.map((s) => ({ ...s, items: [...s.items] }))) });
  const addStep = () => {
    change({ ...def, steps: [...def.steps, newStep(t("Step {n}", { n: def.steps.length + 1 }))] });
    setAt(def.steps.length);
    setSel({ kind: "step" });
  };
  const moveStep = (by: number) => {
    const to = at + by;
    if (to < 0 || to >= def.steps.length) return;
    change(
      withSteps((steps) => {
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
      withSteps((steps) => {
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
    if (def.dbId && def.steps.some((s) => fieldsIn(s.items).length) && !confirmAction(t("Fill another database? The fields of this one leave the form."))) return;
    // (The fields go, the layout — headings, texts, rows and columns — stays.)
    let next = def;
    for (const f of def.steps.flatMap((s) => fieldsIn(s.items))) next = removePart(next, f.id);
    if (dbId) next = placePart(next, fieldItem(TITLE, { required: true }), next.steps[0].id, 0);
    change({ ...next, dbId });
  };

  const selected = sel.kind === "item" ? findPart(def, sel.id) : undefined;
  const pal = "flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";
  const targetName = target === step.id ? "" : nameOf(findPart(def, target)!);

  return (
    <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,1fr)_17rem]">
      <div role="status" aria-live="polite" className="sr-only">
        {said}
      </div>

      {/* The palette */}
      <aside aria-label={t("Parts of the form")} className="space-y-4 self-start text-sm lg:sticky lg:top-4">
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
        {targetName && <p className="rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">{t("＋ adds into the selected {box}.", { box: targetName })}</p>}
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
              <p className="text-xs text-zinc-500">{t("Every field of the database is on the form.")}</p>
            )}
            <NewField
              formId={form.id}
              onMade={(prop, next) => {
                // The database has it now: the form knows it, then it goes on the form (where ＋ adds).
                setForm((cur) => ({ ...cur, db: next.db }));
                onChange?.({ ...form, db: next.db });
                add(fieldItem(prop));
              }}
            />
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
                ["row", "⇢", t("Row (two columns side by side)"), (): FormItem => newBox("row", formItemId)],
                ["col", "⇣", t("Column (parts one under the other)"), (): FormItem => newBox("col", formItemId)],
                ...(form.db ? ([["rows", "☑", t("Rows of the database"), (): FormItem => newRowsItem(props)]] as const) : []),
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
        <p className="text-xs text-zinc-500">{t("Drag parts onto the form, or use ＋. On the form: Alt+↑/↓ moves the selected part, Alt+→ puts it into the box after it, Alt+← takes it out of its box, Delete removes it.")}</p>
      </aside>

      {/* The canvas */}
      <section aria-label={t("The form")} className="@container min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("Steps")}>
          {def.steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-current={i === at ? "step" : undefined}
              className={`rounded-md border px-2.5 py-1 text-sm ${i === at ? "border-indigo-500 bg-indigo-50 font-medium dark:bg-indigo-950" : "border-zinc-200 dark:border-zinc-700"} ${over && over.owner === s.id && i !== at ? "ring-2 ring-indigo-500" : ""}`}
              onClick={() => (setAt(i), setSel({ kind: "step" }))}
              onDragOver={(e) => hover(e, { owner: s.id, index: s.items.length })}
              onDrop={(e) => dropAt(e, s.id, s.items.length)}
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
          {list(step.id, step.items, false, true)}
          <div inert className="flex gap-2">
            {at > 0 && <span className="btn">← {t("Back")}</span>}
            <span className="btn btn-primary">{at < def.steps.length - 1 ? `${t("Next")} →` : def.submitLabel || t("Send")}</span>
          </div>
        </div>
      </section>

      {/* The inspector */}
      <aside aria-label={t("Settings of the selected part")} className="space-y-3 self-start text-sm lg:col-span-2 xl:sticky xl:top-4 xl:col-span-1">
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
            <Text label={t("Title of the step")} value={step.title} onChange={(v) => change(withSteps((steps) => ((steps[at] = { ...steps[at], title: v }), steps)))} />
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
            stepIndex={spotOf(def, selected.id)?.step ?? at}
            nested={(spotOf(def, selected.id)?.owner ?? step.id) !== def.steps[spotOf(def, selected.id)?.step ?? at]?.id}
            onPatch={(p) => change(patchPart(def, selected.id, p))}
            onRemove={() => remove(selected.id)}
            onMove={(by) => move(selected.id, by)}
            onShift={(into) => shift(selected.id, into)}
            onStep={(s) => toStep(selected.id, s)}
          />
        )}
      </aside>
    </div>
  );
}

/** The types a new field can have (forms.ts NEW_FIELD_TYPES — a relation is made in the database). */
const NEW_TYPES: PropType[] = ["text", "markdown", "number", "date", "checkbox", "select", "multi_select", "status", "url", "email", "phone", "person"];

/** "New field": a name, a type (choices for a select) — made in the database the form fills, and put on the form. */
function NewField({ formId, onMade }: { formId: number; onMade: (prop: string, form: FormRun) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<PropType>("text");
  const [choices, setChoices] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choosing = type === "select" || type === "multi_select";
  const make = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    const r = await addFormFieldAction(formId, name, type, choosing ? choices.split(/[,;\n]/) : []);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onMade(r.prop, r.form);
    setName("");
    setChoices("");
  };
  if (!open)
    return (
      <button type="button" className="btn btn-sm w-full justify-center" onClick={() => setOpen(true)}>
        ＋ {t("New field")}
      </button>
    );
  return (
    <div
      className="space-y-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-700"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          void make();
        } else if (e.key === "Escape") setOpen(false);
      }}
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium">{t("Name of the new field")}</span>
        <input autoFocus className="input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Dosis (mg)")} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium">{t("Type")}</span>
        <select className="input w-full" value={type} onChange={(e) => setType(e.target.value as PropType)}>
          {NEW_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(PROP_LABELS[x])}
            </option>
          ))}
        </select>
      </label>
      {choosing && (
        <label className="block space-y-1">
          <span className="text-xs font-medium">{t("Choices (separated by commas)")}</span>
          <input className="input w-full" value={choices} onChange={(e) => setChoices(e.target.value)} placeholder={t("e.g. morning, noon, evening")} />
        </label>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <p className="text-xs text-zinc-500">{t("It is made in the database as well.")}</p>
      <div className="flex gap-2">
        <button type="button" className="btn btn-sm btn-primary" disabled={!name.trim() || busy} onClick={() => void make()}>
          {busy ? t("Making …") : t("Add the field")}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
          {t("Cancel")}
        </button>
      </div>
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
function ItemInspector({ item, def, props, stepIndex, nested, onPatch, onRemove, onMove, onShift, onStep }: { item: FormItem; def: FormDef; props: Property[]; stepIndex: number; /** It sits in a box (a row, a column). */ nested: boolean; onPatch: (p: Partial<FieldItem> | Partial<FlexItem> | Partial<RowsItem> | Partial<FormItem>) => void; onRemove: () => void; onMove: (by: number) => void; onShift: (into: boolean) => void; onStep: (s: number) => void }) {
  const t = useT();
  const prop = item.kind === "field" ? props.find((p) => p.id === item.prop) : undefined;
  const others = def.steps.flatMap((s) => fieldsIn(s.items)).filter((i) => i.id !== item.id);
  const opNames: Record<CondOp, string> = { eq: t("is"), neq: t("is not"), contains: t("contains"), filled: t("is filled"), empty: t("is empty") };
  return (
    <>
      <h2 className="font-semibold">{item.kind === "field" ? (prop?.name ?? item.prop) : item.kind === "heading" ? t("Heading") : item.kind === "text" ? t("Text") : item.kind === "flex" ? (item.dir === "row" ? t("Row") : t("Column")) : t("Divider")}</h2>
      {item.kind === "rows" && <RowsInspector item={item} props={props} onPatch={onPatch} />}
      {item.kind === "flex" && (
        <>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t("Direction")}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {(["row", "col"] as const).map((d) => (
                <label key={d} className="flex items-center gap-1.5">
                  <input type="radio" name={`dir-${item.id}`} className="accent-indigo-600" checked={item.dir === d} onChange={() => onPatch({ dir: d })} />
                  {d === "row" ? t("Row — side by side") : t("Column — one under the other")}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t("Space between")}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {(["sm", "md", "lg"] as const).map((g) => (
                <label key={g} className="flex items-center gap-1.5">
                  <input type="radio" name={`gap-${item.id}`} className="accent-indigo-600" checked={(item.gap ?? "md") === g} onChange={() => onPatch({ gap: g === "md" ? undefined : g })} />
                  {g === "sm" ? t("Small") : g === "md" ? t("Medium") : t("Large")}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-zinc-500">{t("Removing a box keeps what is in it: its parts take its place.")}</p>
        </>
      )}
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
        <button type="button" className="btn btn-sm" onClick={() => onShift(true)} title={t("Into the box after it (Alt+→)")}>
          {t("Into the next box")}
        </button>
        {nested && (
          <button type="button" className="btn btn-sm" onClick={() => onShift(false)} title={t("Out of its box (Alt+←)")}>
            {t("Out of the box")}
          </button>
        )}
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

/** A rows item's settings: its words, its columns (which, in what order), and the stamp ("when [checkbox] is ticked, set [date] to now"). */
function RowsInspector({ item, props, onPatch }: { item: RowsItem; props: Property[]; onPatch: (p: Partial<RowsItem>) => void }) {
  const t = useT();
  const can = props.filter((p) => p.id !== TITLE && ROWS_COL_TYPES.includes(p.type));
  const cols = item.cols.map((c) => can.find((p) => p.id === c)).filter((p): p is Property => !!p);
  const setCols = (next: string[], stamp = item.stamp) => onPatch({ stamp: undefined, ...rowsCols(next, stamp, props) });
  const move = (i: number, by: number) => {
    const next = [...item.cols];
    const [c] = next.splice(i, 1);
    next.splice(i + by, 0, c);
    setCols(next);
  };
  const checks = cols.filter((p) => p.type === "checkbox");
  const dates = cols.filter((p) => p.type === "date");
  return (
    <>
      <Text label={t("Label")} value={item.label ?? ""} placeholder={t("Rows of the database")} onChange={(v) => onPatch({ label: v || undefined })} />
      <Text label={t("Help text")} value={item.help ?? ""} onChange={(v) => onPatch({ help: v || undefined })} />
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">{t("Columns")}</legend>
        <ul className="space-y-1">
          {cols.map((p, i) => (
            <li key={p.id} className="flex items-center gap-1">
              <label className="flex flex-1 items-center gap-1.5">
                <input type="checkbox" className="size-4 accent-indigo-600" checked onChange={() => setCols(item.cols.filter((c) => c !== p.id))} />
                {p.name}
              </label>
              <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("Move {name} up", { name: p.name })} title={t("Move up")}>
                ↑
              </button>
              <button type="button" className="icon-btn" disabled={i === cols.length - 1} onClick={() => move(i, 1)} aria-label={t("Move {name} down", { name: p.name })} title={t("Move down")}>
                ↓
              </button>
            </li>
          ))}
          {can
            .filter((p) => !item.cols.includes(p.id))
            .map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-1.5 text-zinc-500">
                  <input type="checkbox" className="size-4 accent-indigo-600" checked={false} disabled={item.cols.length >= ROWS_MAX_COLS} onChange={() => setCols([...item.cols, p.id])} />
                  {p.name}
                </label>
              </li>
            ))}
        </ul>
      </fieldset>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">{t("Time stamp")}</legend>
        {checks.length && dates.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span>{t("When")}</span>
            <select className="input w-auto py-1" aria-label={t("Checkbox that stamps")} value={item.stamp?.check ?? ""} onChange={(e) => setCols(item.cols, e.target.value ? { check: e.target.value, time: item.stamp?.time ?? dates[0].id } : undefined)}>
              <option value="">{t("— no stamp —")}</option>
              {checks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {item.stamp && (
              <>
                <span>{t("is ticked, set")}</span>
                <select className="input w-auto py-1" aria-label={t("Date set to now")} value={item.stamp.time} onChange={(e) => setCols(item.cols, { check: item.stamp!.check, time: e.target.value })}>
                  {dates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <span>{t("to now")}</span>
              </>
            )}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">{t("A checkbox and a date among the columns can stamp the time a row is ticked.")}</p>
        )}
      </fieldset>
      <p className="text-xs text-zinc-500">{t("Sent, the rows are changed in place — no new row is made for them.")}</p>
    </>
  );
}
