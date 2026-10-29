"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";
import { cellChoicesAction, formRelationChoicesAction, submitFormAction, type Result } from "../actions";
import { fieldLabel, fieldsIn, formErrors, shownFields, stampNow, startAnswers, type Answers, type FieldItem, type FlexItem, type FormItem, type RowsItem } from "../form-spec";
import type { FormDb, FormRow, FormRun, FormSent, RowChanges } from "../forms";
import type { Property } from "../model";

/**
 * A form as it is filled in (BITV 2.0 / WCAG 2.2 AA): every field with its own label, help and error tied to it, required ones
 * marked in words and to the browser, the errors listed at the top (links to the fields) with the focus on the first one, a wizard's
 * step said ("Step 2 of 3"), what was sent said in a status. Fields that hang on a condition come and go as you answer — their
 * values are not sent then. Used by a form's page, /form/<id>, a database's entry dialog and the form block of a page; the
 * designer draws its canvas with the same fields (FieldControl), inert.
 */

/** Names of chosen people and rows (their ids are the answer), by property — the chips show them. */
export type PickedLabels = Record<string, Record<number, string>>;

/** One field's control, as it is filled in — or, `inert`, as the designer shows it (seen, not usable). */
export function FieldControl({ item, prop, value, onChange, uid, error, inert = false, dbId, labels = {}, onLabel }: { item: FieldItem; prop: Property; value: unknown; onChange: (v: unknown) => void; uid: string; error?: string; inert?: boolean; dbId?: number; labels?: Record<number, string>; onLabel?: (id: number, label: string) => void }) {
  const t = useT();
  const id = `${uid}-${item.id}`;
  const helpId = item.help ? `${id}-help` : "";
  const errId = error ? `${id}-err` : "";
  const describedBy = [helpId, errId].filter(Boolean).join(" ") || undefined;
  const label = fieldLabel(item, prop);
  const required = !!item.required;
  const mark = required ? (
    <>
      {" "}
      <span aria-hidden="true" className="text-red-700 dark:text-red-400">
        *
      </span>
      <span className="sr-only">({t("required")})</span>
    </>
  ) : null;
  const help = item.help ? (
    <p id={helpId} className="text-xs text-zinc-500 dark:text-zinc-400">
      {item.help}
    </p>
  ) : null;
  const err = error ? (
    <p id={errId} className="text-sm font-medium text-red-700 dark:text-red-400">
      <span aria-hidden="true">⚠ </span>
      {error}
    </p>
  ) : null;
  const common = { id, required, "aria-required": required || undefined, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy, disabled: inert || undefined };
  const box = `input ${error ? "border-red-600 dark:border-red-500" : ""}`;
  const str = typeof value === "string" || typeof value === "number" ? String(value) : "";

  if (prop.type === "checkbox")
    return (
      <div className="space-y-1">
        <div className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 size-4 accent-indigo-600" checked={value === true} onChange={(e) => onChange(e.target.checked)} {...common} />
          <label htmlFor={id} className="text-sm font-medium">
            {label}
            {mark}
          </label>
        </div>
        {help}
        {err}
      </div>
    );

  if (prop.type === "multi_select") {
    const chosen = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="space-y-1" aria-describedby={describedBy} aria-invalid={error ? true : undefined} aria-required={required || undefined}>
        <legend className="text-sm font-medium">
          {label}
          {mark}
        </legend>
        {help}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {(prop.options ?? []).map((o) => (
            <label key={o.id} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" className="size-4 accent-indigo-600" disabled={inert || undefined} checked={chosen.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...chosen, o.id] : chosen.filter((x) => x !== o.id))} />
              {o.name}
            </label>
          ))}
          {!prop.options?.length && <span className="text-xs text-zinc-500">{t("No choices yet.")}</span>}
        </div>
        {err}
      </fieldset>
    );
  }

  const head = (
    <label htmlFor={id} className="block text-sm font-medium">
      {label}
      {mark}
    </label>
  );
  let control: ReactNode;
  if (prop.type === "select" || prop.type === "status")
    control = (
      <select className={box} value={str} onChange={(e) => onChange(e.target.value)} {...common}>
        <option value="">{item.placeholder || "—"}</option>
        {(prop.options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  else if (prop.type === "markdown") control = <textarea className={box} rows={4} value={str} placeholder={item.placeholder} onChange={(e) => onChange(e.target.value)} {...common} />;
  else if (prop.type === "person" || prop.type === "relation") control = <Picker kind={prop.type} prop={prop} dbId={dbId} value={Array.isArray(value) ? (value as number[]) : []} onChange={onChange} labels={labels} onLabel={onLabel} inputProps={common} placeholder={item.placeholder} className={box} />;
  else {
    const type = prop.type === "date" ? "date" : prop.type === "email" ? "email" : prop.type === "url" ? "url" : prop.type === "phone" ? "tel" : "text";
    const auto = prop.type === "email" ? "email" : prop.type === "phone" ? "tel" : prop.type === "url" ? "url" : undefined;
    control = <input className={box} type={type} inputMode={prop.type === "number" ? "decimal" : undefined} autoComplete={auto} value={str} placeholder={item.placeholder} onChange={(e) => onChange(e.target.value)} {...common} />;
  }
  return (
    <div className="space-y-1">
      {head}
      {help}
      {control}
      {err}
    </div>
  );
}

/** People (from People) or rows of the related database, picked by a search: the chosen ones as chips (each removable). */
function Picker({ kind, prop, dbId, value, onChange, labels, onLabel, inputProps, placeholder, className }: { kind: "person" | "relation"; prop: Property; dbId?: number; value: number[]; onChange: (v: unknown) => void; labels: Record<number, string>; onLabel?: (id: number, label: string) => void; inputProps: Record<string, unknown>; placeholder?: string; className: string }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: number; label: string }[]>([]);
  const [open, setOpen] = useState(false);
  const listId = `${String(inputProps.id)}-list`;
  useEffect(() => {
    if (!open || inputProps.disabled) return;
    let live = true;
    const timer = setTimeout(() => {
      const ask = kind === "person" ? cellChoicesAction("person", q) : dbId ? formRelationChoicesAction(dbId, prop.id, q) : Promise.resolve({ ok: true as const, items: [] });
      void ask.then((r) => live && setHits(r.ok ? r.items.filter((h) => !value.includes(h.id)) : []));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, open, kind, dbId, prop.id, value, inputProps.disabled]);
  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("Chosen")}>
          {value.map((id) => (
            <li key={id} className="ws-chip flex items-center gap-1">
              {labels[id] ?? `#${id}`}
              <button type="button" className="icon-btn size-5 text-xs" disabled={!!inputProps.disabled} aria-label={t("Remove {name}", { name: labels[id] ?? `#${id}` })} onClick={() => onChange(value.filter((x) => x !== id))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <input className={className} type="search" value={q} placeholder={placeholder || (kind === "person" ? t("Search people …") : t("Search entries …"))} onChange={(e) => (setQ(e.target.value), setOpen(true))} onFocus={() => setOpen(true)} autoComplete="off" {...inputProps} required={!!inputProps.required && !value.length} />
      {open && hits.length > 0 && (
        <ul id={listId} className="max-h-48 overflow-y-auto rounded-md border border-zinc-200 p-1 dark:border-zinc-700" aria-label={t("Suggestions")}>
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left text-sm hover:bg-zinc-100 focus-visible:bg-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800"
                onClick={() => {
                  onLabel?.(h.id, h.label);
                  onChange([...value, h.id]);
                  setQ("");
                }}
              >
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A heading, a text or a divider of a form — as it shows (the designer's canvas too). */
export function StaticItem({ item, level = 2 }: { item: Exclude<FormItem, FieldItem | FlexItem | RowsItem>; level?: 2 | 3 }) {
  if (item.kind === "divider") return <hr className="border-zinc-200 dark:border-zinc-700" />;
  if (item.kind === "text") return <p className="text-sm whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">{item.text}</p>;
  const H = level === 2 ? "h2" : "h3";
  return <H className="pt-2 text-lg font-semibold">{item.text}</H>;
}

/** A cell as its control holds it: a tick, a number or a date as words ("2026-10-29T10:10"), a choice's id. */
function inputOf(p: Property, v: unknown): unknown {
  if (p.type === "checkbox") return v === true;
  if (v && typeof v === "object" && "start" in v) return String((v as { start: unknown }).start ?? "");
  return v === null || v === undefined ? "" : String(v);
}

/**
 * The rows of the database, each a line to change in place: its title and one control per column, prefilled with what the row holds
 * (`edits`: what was changed). The stamp's checkbox comes first; ticked, the time beside it is set to now (to be changed still). Each
 * control is named by its column and its row ("Genommen – Venlafaxin"). A wide box shows a line per row, a narrow one a small card.
 */
export function RowsField({ item, db, rows, edits, onEdit, uid }: { item: RowsItem; db: FormDb; rows: FormRow[]; edits: Record<string, Record<string, unknown>>; onEdit: (rowId: number, propId: string, value: unknown) => void; uid: string }) {
  const t = useT();
  const cols = item.cols.map((c) => db.props.find((p) => p.id === c)).filter((p): p is Property => !!p);
  const check = item.stamp ? cols.find((p) => p.id === item.stamp!.check) : undefined;
  const rest = cols.filter((p) => p !== check);
  const helpId = item.help ? `${uid}-${item.id}-help` : undefined;
  const withTime = (p: Property) => p.includeTime || p.id === item.stamp?.time || rows.some((r) => String(inputOf(p, r.cells[p.id])).includes("T"));
  const valueOf = (r: FormRow, p: Property) => (p.id in (edits[r.id] ?? {}) ? edits[r.id][p.id] : inputOf(p, r.cells[p.id]));
  const set = (r: FormRow, p: Property, v: unknown) => {
    onEdit(r.id, p.id, v);
    // Ticked (it wasn't): the time is now — shown, and still to be changed.
    if (check && p.id === check.id && v === true && r.cells[p.id] !== true && item.stamp) onEdit(r.id, item.stamp.time, stampNow());
  };
  const control = (r: FormRow, p: Property) => {
    const id = `${uid}-${item.id}-${r.id}-${p.id}`;
    const name = `${p.name} – ${r.title || t("Untitled")}`;
    const v = valueOf(r, p);
    if (p.type === "checkbox") return <input id={id} type="checkbox" className="size-4 accent-indigo-600" aria-label={name} checked={v === true} onChange={(e) => set(r, p, e.target.checked)} />;
    if (p.type === "select" || p.type === "status")
      return (
        <select id={id} className="input w-auto py-1" aria-label={name} value={String(v)} onChange={(e) => set(r, p, e.target.value)}>
          <option value="">—</option>
          {(p.options ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
    const type = p.type === "date" ? (withTime(p) ? "datetime-local" : "date") : p.type === "email" ? "email" : p.type === "url" ? "url" : p.type === "phone" ? "tel" : "text";
    const date = p.type === "date" ? (type === "date" ? String(v).slice(0, 10) : String(v).slice(0, 16)) : String(v);
    return <input id={id} className={`input py-1 ${p.type === "number" ? "w-24" : p.type === "date" ? "w-auto" : "w-40"}`} type={type} inputMode={p.type === "number" ? "decimal" : undefined} aria-label={name} value={date} onChange={(e) => set(r, p, e.target.value)} />;
  };
  return (
    <fieldset className="space-y-2" aria-describedby={helpId}>
      <legend className="text-sm font-medium">{item.label || db.title}</legend>
      {item.help && (
        <p id={helpId} className="text-xs text-zinc-500 dark:text-zinc-400">
          {item.help}
        </p>
      )}
      {!rows.length ? (
        <p className="text-sm text-zinc-500">{t("No entries yet.")}</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
              {check && control(r, check)}
              {check ? (
                <label htmlFor={`${uid}-${item.id}-${r.id}-${check.id}`} className="min-w-32 flex-1 font-medium">
                  {r.title || t("Untitled")}
                </label>
              ) : (
                <span className="min-w-32 flex-1 font-medium">{r.title || t("Untitled")}</span>
              )}
              {rest.map((p) => (
                <span key={p.id} className="flex items-center gap-1.5 text-sm">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400" aria-hidden="true">
                    {p.name}
                  </span>
                  {control(r, p)}
                  {p.type === "number" && p.unit && (
                    <span className="text-xs text-zinc-500" aria-hidden="true">
                      {p.unit}
                    </span>
                  )}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

const GAPS = { sm: "gap-2", md: "gap-4", lg: "gap-6" } as const;
/**
 * A box's own layout (the designer's canvas draws it the same): a row side by side once the form itself is wide enough (a
 * container query — the form's width, not the window's: a form beside the designer's panels or in a page column is narrow), a
 * column one under the other.
 */
export const flexClass = (box: Pick<FlexItem, "dir" | "gap">): string => `flex flex-col ${GAPS[box.gap ?? "md"]} ${box.dir === "row" ? "@md:flex-row @md:items-start" : ""}`;
/** A part inside a row shares it with the others (inside a column it is as wide as the column). */
export const flexChildClass = (box: Pick<FlexItem, "dir">): string => (box.dir === "row" ? "min-w-0 @md:flex-1 @md:basis-0" : "min-w-0");

/** "Step 2 of 3 — Contact": what a wizard says above its fields (a progress bar beside it, the words for screen readers). */
export function StepProgress({ at, of, title }: { at: number; of: number; title: string }) {
  const t = useT();
  if (of < 2) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
        {t("Step {n} of {total}", { n: at + 1, total: of })}
        {title ? ` — ${title}` : ""}
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden="true">
        <div className="h-full bg-indigo-600" style={{ width: `${((at + 1) / of) * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * A form to fill in. `submit` sends the answers (default: the form page's own action); `onDone` hears of the row made (a dialog
 * closes then) — without it, the thanks show with "Add another" and a link to the entry. `heading`: the form's title is shown.
 */
export function FormRunner({ form, submit, onDone, onCancel, heading = true, headingLevel = 1 }: { form: FormRun; submit?: (answers: Answers) => Promise<Result<FormSent>>; onDone?: (rowId: number | null, updated: number) => void; onCancel?: () => void; heading?: boolean; headingLevel?: 1 | 2 }) {
  const t = useT();
  const uid = useId().replace(/:/g, "");
  const { def, db } = form;
  const props = useMemo(() => db?.props ?? [], [db]);
  const [answers, setAnswers] = useState<Answers>(() => startAnswers(def, props));
  const [labels, setLabels] = useState<PickedLabels>({});
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [done, setDone] = useState<{ id: number | null; updated: number } | null>(null);
  // The rows items' changes (by item, row, column), and the rows as they are now (what was sent goes into them).
  const [edits, setEdits] = useState<RowChanges>({});
  const [rowsNow, setRowsNow] = useState<FormRow[]>(form.rows ?? []);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const summary = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const [focusFirst, setFocusFirst] = useState(0);
  const steps = def.steps;
  const cur = steps[Math.min(step, steps.length - 1)];
  const shown = shownFields(def, answers, props);
  const last = step >= steps.length - 1;
  // (The fields of the step, those in rows and columns too — in the order they show.)
  const curFields = fieldsIn(cur.items);
  const errorList = curFields.filter((i) => !!errors[i.id] && shown.has(i.id));

  // After a failed send or step: the focus on the first field that is wrong (the summary above says them all).
  useEffect(() => {
    if (!focusFirst) return;
    const first = errorList[0];
    const el = first ? (document.getElementById(`${uid}-${first.id}`) ?? summary.current) : summary.current;
    el?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per failed attempt
  }, [focusFirst]);

  if (!db)
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-700" role="note">
        {t("This form has no database to fill yet — choose one in the designer.")}
      </p>
    );

  const set = (prop: string, v: unknown) => {
    setAnswers((a) => ({ ...a, [prop]: v }));
    // A field put right loses its error (the others stay until the next try).
    const item = curFields.find((i) => i.prop === prop);
    if (item && errors[item.id])
      setErrors((cur) => {
        const rest = { ...cur };
        delete rest[item.id];
        return rest;
      });
  };
  // What is sent: only the fields that show (and those not asked — the server sets their defaults itself).
  const sendable = () => ({ ...Object.fromEntries(Object.entries(answers).filter(([k]) => def.steps.some((s) => fieldsIn(s.items).some((i) => i.prop === k && shown.has(i.id))))), ...(Object.keys(edits).length ? { rows: edits } : {}) });
  const edit = (itemId: string) => (rowId: number, propId: string, value: unknown) => setEdits((e) => ({ ...e, [itemId]: { ...e[itemId], [rowId]: { ...e[itemId]?.[rowId], [propId]: value } } }));
  /** What the form says when it is sent: its thanks, and how many entries were changed. */
  const thanks = (d: { id: number | null; updated: number }) => [d.id !== null || !d.updated ? def.thanks || t("Thank you — it is saved.") : "", d.updated ? (d.updated === 1 ? t("1 entry updated.") : t("{n} entries updated.", { n: d.updated })) : ""].filter(Boolean).join(" ");
  const fail = (errs: Record<string, string>) => {
    setErrors(errs);
    // A wrong field on an earlier step (the server's check): back to that step.
    const at = steps.findIndex((s) => fieldsIn(s.items).some((i) => errs[i.id]));
    if (at >= 0 && at !== step) setStep(at);
    setFocusFirst((n) => n + 1);
  };
  const next = () => {
    const errs = formErrors(def, answers, props, t, cur.id);
    if (Object.keys(errs).length) return fail(errs);
    setErrors({});
    setStep((s) => s + 1);
    setSaid(t("Step {n} of {total}", { n: step + 2, total: steps.length }) + (steps[step + 1]?.title ? ` — ${steps[step + 1].title}` : ""));
    top.current?.focus();
  };
  const send = async () => {
    const errs = formErrors(def, answers, props, t);
    if (Object.keys(errs).length) return fail(errs);
    setBusy(true);
    setFailure("");
    const r = await (submit ?? ((a: Answers) => submitFormAction(form.id, a)))(sendable());
    setBusy(false);
    if (!r.ok) return setFailure(r.error);
    if (Object.keys(r.errors).length) return fail(r.errors);
    setErrors({});
    // (The rows hold what was sent now: a next round starts from there.)
    const sent = Object.values(edits).reduce<Record<string, Record<string, unknown>>>((all, byRow) => {
      for (const [rid, vals] of Object.entries(byRow)) all[rid] = { ...all[rid], ...vals };
      return all;
    }, {});
    setRowsNow((rows) => rows.map((row) => (sent[row.id] ? { ...row, cells: { ...row.cells, ...sent[row.id] } } : row)));
    setEdits({});
    setSaid(thanks(r));
    if (onDone) return onDone(r.id, r.updated);
    setDone({ id: r.id, updated: r.updated });
  };
  const again = () => {
    setAnswers(startAnswers(def, props));
    setLabels({});
    setStep(0);
    setDone(null);
    setSaid("");
  };
  const H = headingLevel === 1 ? "h1" : "h2";
  /** One part of the step: a field, a heading, a text, a divider — or a box with its parts (a plain div: layout only). */
  const part = (item: FormItem, top: boolean): ReactNode => {
    if (item.kind === "flex")
      return (
        <div key={item.id} className={`${flexClass(item)} ${top ? "@md:col-span-2" : ""}`}>
          {item.items.map((c) => {
            const inner = part(c, false);
            return inner === null ? null : (
              <div key={c.id} className={flexChildClass(item)}>
                {inner}
              </div>
            );
          })}
        </div>
      );
    if (item.kind === "rows")
      return (
        <div key={item.id} className={top ? "@md:col-span-2" : ""}>
          <RowsField item={item} db={db} rows={rowsNow} edits={edits[item.id] ?? {}} onEdit={edit(item.id)} uid={uid} />
        </div>
      );
    if (item.kind !== "field")
      return (
        <div key={item.id} className={top ? "@md:col-span-2" : ""}>
          <StaticItem item={item} level={headingLevel === 1 ? 2 : 3} />
        </div>
      );
    const prop = props.find((p) => p.id === item.prop);
    if (!prop || !shown.has(item.id)) return null;
    return (
      <div key={item.id} className={!top || item.width === "half" ? "" : "@md:col-span-2"}>
        <FieldControl item={item} prop={prop} value={answers[item.prop]} onChange={(v) => set(item.prop, v)} uid={uid} error={errors[item.id]} dbId={db.id} labels={labels[item.prop]} onLabel={(id, label) => setLabels((l) => ({ ...l, [item.prop]: { ...l[item.prop], [id]: label } }))} />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div role="status" aria-live="polite" className="sr-only">
        {said}
      </div>
      {done !== null ? (
        <div className="space-y-3 py-6 text-center">
          <p className="text-lg font-medium">
            <span aria-hidden="true">✅ </span>
            {thanks(done)}
          </p>
          <div className="flex justify-center gap-2">
            <button type="button" className="btn btn-primary" onClick={again}>
              {done.id === null ? t("Back to the form") : t("Add another")}
            </button>
            {done.id !== null && (
              <Link href={`/workspace/${done.id}`} className="btn">
                {t("Open the entry")}
              </Link>
            )}
          </div>
        </div>
      ) : (
        <form
          noValidate
          aria-labelledby={heading ? `${uid}-title` : undefined}
          aria-label={heading ? undefined : def.title || form.title || t("Form")}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (last) void send();
            else next();
          }}
        >
          <div ref={top} tabIndex={-1} className="space-y-1 outline-none">
            {heading && (
              <H id={`${uid}-title`} className={headingLevel === 1 ? "text-2xl font-semibold" : "text-lg font-semibold"}>
                {def.title || form.title || t("Form")}
              </H>
            )}
            {def.intro && <p className="text-sm whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">{def.intro}</p>}
          </div>
          <StepProgress at={step} of={steps.length} title={cur.title} />
          {errorList.length > 0 && (
            <div ref={summary} tabIndex={-1} role="alert" className="alert-error space-y-1 outline-none" aria-labelledby={`${uid}-errs`}>
              <p id={`${uid}-errs`} className="font-semibold">
                {errorList.length === 1 ? t("1 field needs your attention:") : t("{n} fields need your attention:", { n: errorList.length })}
              </p>
              <ul className="list-disc pl-5">
                {errorList.map((f) => (
                  <li key={f.id}>
                    <a
                      href={`#${uid}-${f.id}`}
                      className="underline"
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(`${uid}-${f.id}`)?.focus();
                      }}
                    >
                      {errors[f.id]}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {curFields.some((i) => i.required && shown.has(i.id)) && <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("Fields marked * are required.")}</p>}
          <div className="@container grid grid-cols-1 gap-x-4 gap-y-4 @md:grid-cols-2">
            {cur.items.map((item) => part(item, true))}
          </div>
          {failure && (
            <p role="alert" className="alert-error">
              {failure}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {step > 0 && (
              <button type="button" className="btn" onClick={() => (setErrors({}), setStep(step - 1), top.current?.focus())}>
                ← {t("Back")}
              </button>
            )}
            <button className="btn btn-primary" disabled={busy} aria-disabled={busy || undefined}>
              {busy ? t("Sending …") : last ? def.submitLabel || t("Send") : `${t("Next")} →`}
            </button>
            {onCancel && (
              <button type="button" className="btn" onClick={onCancel}>
                {t("Cancel")}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
