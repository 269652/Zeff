"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import type { DatabaseData } from "../actions";
import { checkFormula, FORMULA_FUNCTIONS } from "../formula";
import { columnOrder, condsFor, COLORS, CREATED, hasDependents, isFilter, moveBefore, needsValue, newId, removeProperty, PROP_LABELS, PROP_TYPES, retype, ROLLUP_FNS, TITLE, UPDATED, type Cond, type DbSchema, type Filter, type Option, type Property, type PropType, type Rule, type Sort, type View } from "../model";
import { makeOption, Tag } from "./cells";
import { Modal, useSortable } from "./kit";

/** The menus of a database: filter, sort, properties, and the schema editor. */

type PropChoice = { id: string; name: string; type: PropType | "title" };

const allProps = (schema: DbSchema, titleLabel: string): PropChoice[] => [{ id: TITLE, name: schema.titleName || titleLabel, type: "title" }, ...schema.properties.map((p) => ({ id: p.id, name: p.name, type: p.type })), { id: CREATED, name: "Created", type: "created_time" as const }, { id: UPDATED, name: "Edited", type: "updated_time" as const }];

const condLabel = (t: ReturnType<typeof useT>): Record<Cond, string> => ({
  contains: t("contains"),
  not_contains: t("doesn't contain"),
  is: t("is"),
  is_not: t("is not"),
  starts_with: t("starts with"),
  ends_with: t("ends with"),
  is_empty: t("is empty"),
  not_empty: t("is not empty"),
  eq: "=",
  neq: "≠",
  gt: ">",
  lt: "<",
  gte: "≥",
  lte: "≤",
  before: t("is before"),
  after: t("is after"),
  on_or_before: t("is on or before"),
  on_or_after: t("is on or after"),
  past_week: t("in the past week"),
  past_month: t("in the past month"),
  next_week: t("in the next week"),
  next_month: t("in the next month"),
  this_week: t("is this week"),
  today: t("is today"),
  checked: t("is checked"),
  unchecked: t("is not checked"),
});

function RuleRow({ rule, schema, data, onChange, onRemove }: { rule: Rule; schema: DbSchema; data: DatabaseData; onChange: (r: Rule) => void; onRemove: () => void }) {
  const t = useT();
  const props = allProps(schema, t("Title"));
  const choice = props.find((p) => p.id === rule.prop) ?? props[0];
  const prop = schema.properties.find((p) => p.id === rule.prop);
  const conds = condsFor(choice.type);
  const labels = condLabel(t);
  const value = (() => {
    if (!needsValue(rule.cond)) return null;
    if (prop && (prop.type === "select" || prop.type === "status" || prop.type === "multi_select"))
      return (
        <select className="input text-sm" value={String(rule.value ?? "")} onChange={(e) => onChange({ ...rule, value: e.target.value })} aria-label={t("Value")}>
          <option value="">—</option>
          {(prop.options ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
    if (prop?.type === "person")
      return (
        <select className="input text-sm" value={String(rule.value ?? "")} onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })} aria-label={t("Value")}>
          <option value="">—</option>
          {Object.entries(data.labels.people).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      );
    if (prop?.type === "relation" && prop.relationDb !== undefined)
      return (
        <select className="input text-sm" value={String(rule.value ?? "")} onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })} aria-label={t("Value")}>
          <option value="">—</option>
          {(data.related[prop.relationDb]?.rows ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.title || t("Untitled")}
            </option>
          ))}
        </select>
      );
    const date = choice.type === "date" || choice.type === "created_time" || choice.type === "updated_time";
    return <input className="input text-sm" type={date ? "date" : choice.type === "number" ? "number" : "text"} value={String(rule.value ?? "")} onChange={(e) => onChange({ ...rule, value: e.target.value })} aria-label={t("Value")} />;
  })();
  return (
    <div className="flex flex-wrap items-center gap-1">
      <select
        className="input text-sm"
        value={rule.prop}
        aria-label={t("Property")}
        onChange={(e) => {
          const next = props.find((p) => p.id === e.target.value)!;
          onChange({ prop: next.id, cond: condsFor(next.type)[0], value: undefined });
        }}
      >
        {props.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select className="input text-sm" value={rule.cond} aria-label={t("Condition")} onChange={(e) => onChange({ ...rule, cond: e.target.value as Cond })}>
        {conds.map((c) => (
          <option key={c} value={c}>
            {labels[c]}
          </option>
        ))}
      </select>
      {value}
      <button type="button" className="icon-btn" onClick={onRemove} aria-label={t("Remove the rule")}>
        ✕
      </button>
    </div>
  );
}

/** The rules of a view's filter: any depth of and/or groups. */
export function FilterEditor({ filter, schema, data, onChange, depth = 0 }: { filter: Filter; schema: DbSchema; data: DatabaseData; onChange: (f: Filter) => void; depth?: number }) {
  const t = useT();
  const set = (i: number, r: Rule | Filter) => onChange({ ...filter, rules: filter.rules.map((x, j) => (j === i ? r : x)) });
  const first = allProps(schema, t("Title"))[0];
  return (
    <div className={`space-y-1.5 ${depth ? "rounded-md border border-zinc-200 p-2 dark:border-zinc-700" : ""}`}>
      {filter.rules.map((r, i) => (
        <div key={i} className="flex flex-wrap items-start gap-1.5">
          <span className="w-12 pt-1.5 text-xs text-zinc-500">
            {i === 0 ? t("Where") : (
              <select className="input px-1 text-xs" value={filter.op} aria-label={t("And / or")} onChange={(e) => onChange({ ...filter, op: e.target.value as "and" | "or" })}>
                <option value="and">{t("and")}</option>
                <option value="or">{t("or")}</option>
              </select>
            )}
          </span>
          <div className="min-w-0 flex-1">
            {isFilter(r) ? (
              <FilterEditor filter={r} schema={schema} data={data} depth={depth + 1} onChange={(f) => (f.rules.length ? set(i, f) : onChange({ ...filter, rules: filter.rules.filter((_, j) => j !== i) }))} />
            ) : (
              <RuleRow rule={r} schema={schema} data={data} onChange={(x) => set(i, x)} onRemove={() => onChange({ ...filter, rules: filter.rules.filter((_, j) => j !== i) })} />
            )}
          </div>
        </div>
      ))}
      <div className="flex gap-2 pl-[3.4rem]">
        <button type="button" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => onChange({ ...filter, rules: [...filter.rules, { prop: first.id, cond: condsFor(first.type)[0] }] })}>
          + {t("Add a rule")}
        </button>
        {depth < 2 && (
          <button type="button" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => onChange({ ...filter, rules: [...filter.rules, { op: "and", rules: [{ prop: first.id, cond: condsFor(first.type)[0] }] }] })}>
            + {t("Add a group")}
          </button>
        )}
      </div>
    </div>
  );
}

export function SortEditor({ sorts, schema, onChange }: { sorts: Sort[]; schema: DbSchema; onChange: (s: Sort[]) => void }) {
  const t = useT();
  const props = allProps(schema, t("Title"));
  return (
    <div className="space-y-1.5">
      {sorts.map((s, i) => (
        <div key={i} className="flex items-center gap-1">
          <select className="input text-sm" value={s.prop} aria-label={t("Property")} onChange={(e) => onChange(sorts.map((x, j) => (j === i ? { ...x, prop: e.target.value } : x)))}>
            {props.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select className="input text-sm" value={s.dir} aria-label={t("Direction")} onChange={(e) => onChange(sorts.map((x, j) => (j === i ? { ...x, dir: e.target.value as "asc" | "desc" } : x)))}>
            <option value="asc">{t("Ascending")}</option>
            <option value="desc">{t("Descending")}</option>
          </select>
          <button type="button" className="icon-btn" aria-label={t("Remove the sort")} onClick={() => onChange(sorts.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => onChange([...sorts, { prop: props[0].id, dir: "asc" }])}>
        + {t("Add a sort")}
      </button>
    </div>
  );
}

/** Which properties a view shows, and in what order. */
export function PropertiesMenu({ view, schema, onChange }: { view: View; schema: DbSchema; onChange: (v: View) => void }) {
  const t = useT();
  // The title is one of the columns (it can be moved too, but not hidden).
  const ids = columnOrder(view, schema);
  const named = new Map<string, string>([[TITLE, schema.titleName || t("Title")], ...schema.properties.map((p): [string, string] => [p.id, p.name])]);
  const set = (next: string[]) => onChange({ ...view, order: next });
  const sort = useSortable((from, to, after) => set(moveBefore(ids, from, to, after)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    set(moveBefore(ids, ids[i], ids[j], d > 0));
  };
  return (
    <ul className="w-64 space-y-0.5 p-1">
      {ids.map((id, i) => (
        <li key={id} className={`flex items-center gap-1.5 rounded text-sm ${sort.mark(id)}`} {...sort.target(id)}>
          <span className="cursor-grab px-0.5 text-zinc-400" title={t("Drag to move")} aria-hidden {...sort.handle(id)}>
            ⠿
          </span>
          {id === TITLE ? (
            <input type="checkbox" checked disabled aria-label={t("Title")} />
          ) : (
            <input type="checkbox" checked={!view.hidden.includes(id)} onChange={(e) => onChange({ ...view, hidden: e.target.checked ? view.hidden.filter((x) => x !== id) : [...view.hidden, id] })} aria-label={t("Show {name}", { name: named.get(id) ?? "" })} />
          )}
          <span className="min-w-0 flex-1 truncate">{named.get(id)}</span>
          <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("Move up")}>
            ↑
          </button>
          <button type="button" className="icon-btn" disabled={i === ids.length - 1} onClick={() => move(i, 1)} aria-label={t("Move down")}>
            ↓
          </button>
        </li>
      ))}
      {!schema.properties.length && <li className="px-1 text-xs text-zinc-500">{t("No properties yet.")}</li>}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The schema editor: properties, their types and options
// ---------------------------------------------------------------------------

function OptionsEditor({ p, onChange }: { p: Property; onChange: (o: Option[]) => void }) {
  const t = useT();
  const opts = p.options ?? [];
  const status = p.type === "status";
  return (
    <div className="space-y-1">
      {opts.map((o, i) => (
        <div key={o.id} className="flex items-center gap-1">
          <select className="input px-1 text-xs" value={o.color} aria-label={t("Colour")} onChange={(e) => onChange(opts.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))}>
            {COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input className="input min-w-0 flex-1 basis-32 text-sm" value={o.name} aria-label={t("Option")} onChange={(e) => onChange(opts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          {status && (
            <select className="input px-1 text-xs" value={o.group ?? "todo"} aria-label={t("Group")} onChange={(e) => onChange(opts.map((x, j) => (j === i ? { ...x, group: e.target.value as Option["group"] } : x)))}>
              <option value="todo">{t("To do")}</option>
              <option value="doing">{t("In progress")}</option>
              <option value="done">{t("Done")}</option>
            </select>
          )}
          <Tag option={o} />
          <button type="button" className="icon-btn" aria-label={t("Remove the option")} onClick={() => onChange(opts.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => onChange([...opts, makeOption(t("Option {n}", { n: opts.length + 1 }), opts.length, status ? "todo" : undefined)])}>
        + {t("Add an option")}
      </button>
    </div>
  );
}

function PropertyEditor({ p, schema, data, dbId, onChange, onRemove, databases, sort }: { sort: ReturnType<typeof useSortable>; p: Property; schema: DbSchema; data: DatabaseData; dbId: number; onChange: (p: Property) => void; onRemove: () => void; databases: { id: number; title: string }[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const formulaError = p.type === "formula" && p.formula ? checkFormula(p.formula) : null;
  const rel = p.type === "rollup" ? schema.properties.find((x) => x.id === p.rollup?.relation) : undefined;
  const relatedProps = rel?.relationDb !== undefined ? data.related[rel.relationDb]?.properties ?? [] : [];
  const computed = p.type === "rollup" || p.type === "formula" || p.type === "created_time" || p.type === "updated_time" || (p.type === "relation" && !!p.backOf);
  return (
    <li className={`rounded-lg border border-zinc-200 p-2 dark:border-zinc-700 ${sort.mark(p.id)}`} {...sort.target(p.id)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="cursor-grab px-0.5 text-zinc-400" title={t("Drag to move")} aria-hidden {...sort.handle(p.id)}>
          ⠿
        </span>
        <input className="input min-w-0 flex-1 basis-40 text-sm" value={p.name} aria-label={t("Name")} onChange={(e) => onChange({ ...p, name: e.target.value })} />
        <select
          className="input w-auto shrink-0 text-sm"
          value={p.type}
          aria-label={t("Type")}
          disabled={p.type === "relation" && !!p.backOf}
          onChange={(e) => {
            onChange(retype(p, e.target.value as PropType));
          }}
        >
          {PROP_TYPES.filter((x) => x !== "relation" || p.type === "relation" || true).map((x) => (
            <option key={x} value={x}>
              {t(PROP_LABELS[x])}
            </option>
          ))}
        </select>
        <button type="button" className="icon-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t("Settings")}>
          ⚙
        </button>
        <button type="button" className="icon-btn" onClick={onRemove} aria-label={t("Delete the property")}>
          🗑
        </button>
      </div>
      {(open || p.type === "formula" || p.type === "rollup" || p.type === "relation") && (
        <div className="mt-2 space-y-2 border-t border-zinc-200 pt-2 text-sm dark:border-zinc-700">
          {(p.type === "select" || p.type === "multi_select" || p.type === "status") && <OptionsEditor p={p} onChange={(options) => onChange({ ...p, options })} />}
          {p.type === "number" && (
            <label className="flex items-center gap-2">
              {t("Format")}
              <select className="input text-sm" value={p.format ?? "number"} onChange={(e) => onChange({ ...p, format: e.target.value as Property["format"] })}>
                <option value="number">{t("Number")}</option>
                <option value="percent">{t("Percent")}</option>
                <option value="euro">€</option>
                <option value="dollar">$</option>
                <option value="hours">{t("Hours")}</option>
              </select>
            </label>
          )}
          {p.type === "date" && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!p.includeTime} onChange={(e) => onChange({ ...p, includeTime: e.target.checked })} /> {t("Include the time")}
            </label>
          )}
          {p.type === "ai" && <textarea className="input w-full text-sm" rows={2} value={p.aiPrompt ?? ""} placeholder={t("What should the AI fill in? (e.g. “A one-line summary of the page”)")} onChange={(e) => onChange({ ...p, aiPrompt: e.target.value })} aria-label={t("Instruction")} />}
          {p.type === "ai" && (
            <input
              className="input w-full text-sm"
              defaultValue={(p.aiChoices ?? []).join(", ")}
              placeholder={t("Choices, comma separated (empty: free text)")}
              onBlur={(e) => {
                const choices = [...new Set(e.target.value.split(",").map((c) => c.trim()).filter(Boolean))];
                onChange({ ...p, aiChoices: choices.length ? choices : undefined });
              }}
              aria-label={t("Choices")}
            />
          )}
          {p.type === "formula" && (
            <div className="space-y-1">
              <textarea className="input w-full font-mono text-xs" rows={3} value={p.formula ?? ""} placeholder={'prop("Hours") * 80'} onChange={(e) => onChange({ ...p, formula: e.target.value })} aria-label={t("Formula")} />
              {formulaError ? <p className="text-xs text-red-600 dark:text-red-400">{formulaError}</p> : <p className="text-xs text-zinc-500">{t("Functions: {list}", { list: FORMULA_FUNCTIONS.join(", ") })}</p>}
            </div>
          )}
          {p.type === "relation" && !p.backOf && (
            <div className="space-y-1">
              <label className="flex items-center gap-2">
                {t("Related database")}
                <select className="input text-sm" value={p.relationDb ?? ""} onChange={(e) => onChange({ ...p, relationDb: e.target.value === "" ? undefined : Number(e.target.value) })} aria-label={t("Related database")}>
                  <option value="">—</option>
                  <option value={dbId}>{t("This database")}</option>
                  {databases.filter((d) => d.id !== dbId).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </label>
              {p.relationDb !== undefined && p.relationDb !== dbId && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={!!p.twoWay} onChange={(e) => onChange({ ...p, twoWay: e.target.checked })} /> {t("Show it on the related database too")}
                </label>
              )}
            </div>
          )}
          {p.type === "rollup" && (
            <div className="flex flex-wrap items-center gap-1.5">
              <select className="input text-sm" value={p.rollup?.relation ?? ""} aria-label={t("Relation")} onChange={(e) => onChange({ ...p, rollup: { relation: e.target.value, property: TITLE, fn: p.rollup?.fn ?? "count" } })}>
                <option value="">{t("Relation …")}</option>
                {schema.properties.filter((x) => x.type === "relation").map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <select className="input text-sm" value={p.rollup?.property ?? ""} aria-label={t("Property")} onChange={(e) => onChange({ ...p, rollup: { relation: p.rollup?.relation ?? "", property: e.target.value, fn: p.rollup?.fn ?? "count" } })}>
                <option value={TITLE}>{t("Title")}</option>
                {relatedProps.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <select className="input text-sm" value={p.rollup?.fn ?? "count"} aria-label={t("Calculate")} onChange={(e) => onChange({ ...p, rollup: { relation: p.rollup?.relation ?? "", property: p.rollup?.property ?? TITLE, fn: e.target.value as NonNullable<Property["rollup"]>["fn"] } })}>
                {ROLLUP_FNS.map((f) => (
                  <option key={f} value={f}>
                    {f.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <select className="input text-sm" value={p.format ?? "number"} aria-label={t("Format")} onChange={(e) => onChange({ ...p, format: e.target.value as Property["format"] })}>
                <option value="number">{t("Number")}</option>
                <option value="percent">{t("Percent")}</option>
                <option value="hours">{t("Hours")}</option>
              </select>
            </div>
          )}
          {computed && p.type !== "formula" && p.type !== "rollup" && <p className="text-xs text-zinc-500">{t("Computed — it can't be edited by hand.")}</p>}
        </div>
      )}
    </li>
  );
}

/** Properties of a database: add, rename, change the type, options, formulas, rollups, relations — saved as one change. */
export function SchemaModal({ schema, data, dbId, databases, onSave, onClose }: { schema: DbSchema; data: DatabaseData; dbId: number; databases: { id: number; title: string }[]; onSave: (s: DbSchema) => Promise<string | null>; onClose: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<DbSchema>(schema);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const sort = useSortable((from, to, after) => {
    const ids = moveBefore(draft.properties.map((p) => p.id), from, to, after);
    setDraft({ ...draft, properties: ids.map((id) => draft.properties.find((p) => p.id === id)!) });
  });
  return (
    <Modal title={t("Properties")} onClose={onClose} wide>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          {t("Name of the title column")}
          <input className="input text-sm" value={draft.titleName} onChange={(e) => setDraft({ ...draft, titleName: e.target.value })} />
        </label>
        <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
          {draft.properties.map((p, i) => (
            <PropertyEditor
              key={p.id}
              p={p}
              schema={draft}
              data={data}
              dbId={dbId}
              databases={databases}
              sort={sort}
              onChange={(np) => setDraft({ ...draft, properties: draft.properties.map((x, j) => (j === i ? np : x)) })}
              onRemove={() => {
                if (hasDependents(draft, p.id) && !window.confirm(t("Other properties use this one (a rollup or a relation's other side). Delete it anyway?"))) return;
                setDraft(removeProperty(draft, p.id));
              }}
            />
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-sm" onClick={() => setDraft({ ...draft, properties: [...draft.properties, { id: newId("p"), name: t("Property {n}", { n: draft.properties.length + 1 }), type: "text" }] })}>
            + {t("Add a property")}
          </button>
        </div>
        {err && (
          <p role="alert" className="alert-error text-sm">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={async () => {
              const bad = draft.properties.find((p) => p.type === "formula" && p.formula && checkFormula(p.formula));
              if (bad) return setErr(t("The formula of “{name}” has an error.", { name: bad.name }));
              setBusy(true);
              const e = await onSave(draft);
              setBusy(false);
              if (e) setErr(e);
              else onClose();
            }}
          >
            {t("Save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
