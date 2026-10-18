"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { databaseSchemaAction, relationSourcesAction, type DatabaseData } from "../actions";
import { newId, TITLE, type DbSchema, type Filter, type Property, type RollupFn } from "../model";
import { FilterEditor } from "./db-menus";

/**
 * "Calculate from other data": the way to add a total — hours booked per ticket, open tasks per project — in one place instead of a
 * relation plus a rollup by hand. Pick where the data is (a source like the booked time, or a database), how a row of this database
 * finds its rows there, what to calculate and, if you like, which of them count. It adds the two properties (the relation hidden).
 */

type Other = { title: string; schema: DbSchema };

/** The property of the other data that most likely names the same thing as this database's rows (Ticket, Key, Name …). */
const guess = (other: DbSchema, mine: string): string => {
  const want = [mine, "ticket", "key", "name", "title"].map((x) => x.trim().toLowerCase());
  for (const w of want) {
    const p = other.properties.find((x) => x.name.trim().toLowerCase() === w && x.type === "text");
    if (p) return p.id;
  }
  return TITLE;
};

export function RollupWizard({ draft, data, databases, dbId, onAdd, onClose }: { draft: DbSchema; data: DatabaseData; databases: { id: number; title: string }[]; dbId: number; onAdd: (props: Property[], hide: string) => void; onClose: () => void }) {
  const t = useT();
  const FNS: [RollupFn, string][] = [["sum", t("Sum")], ["count", t("Count")], ["average", t("Average")], ["min", t("Smallest")], ["max", t("Largest")], ["latest", t("Latest date")], ["earliest", t("Earliest date")]];
  const [sources, setSources] = useState<{ id: string; label: string; icon: string; schema: DbSchema }[]>([]);
  const [from, setFrom] = useState(""); // "source:time" | "db:12"
  const [other, setOther] = useState<Other | null>(null);
  const [mine, setMine] = useState(TITLE);
  const [theirs, setTheirs] = useState(TITLE);
  const [fn, setFn] = useState<RollupFn>("sum");
  const [prop, setProp] = useState("");
  const [filter, setFilter] = useState<Filter | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    void relationSourcesAction().then((r) => r.ok && setSources(r.sources));
  }, []);

  const pick = async (key: string) => {
    setFrom(key);
    setFilter(null);
    let o: Other | null = null;
    if (key.startsWith("source:")) {
      const s = sources.find((x) => `source:${x.id}` === key);
      if (s) o = { title: s.label, schema: s.schema };
    } else if (key.startsWith("db:")) {
      const r = await databaseSchemaAction(Number(key.slice(3)));
      if (r.ok) o = { title: r.title, schema: r.schema };
    }
    setOther(o);
    if (o) {
      setMine(TITLE);
      setTheirs(guess(o.schema, draft.titleName));
      const num = o.schema.properties.find((p) => p.type === "number");
      setProp(num?.id ?? "");
      setFn(num ? "sum" : "count");
      setName(o.title);
    }
  };

  const mineProps = draft.properties.filter((p) => p.type !== "rollup" && p.type !== "formula" && p.type !== "relation");
  const target = other?.schema.properties.find((p) => p.id === prop);
  const valueProps = other?.schema.properties.filter((p) => p.type === "number" || p.type === "date") ?? [];
  const nameOf = (id: string, s: DbSchema) => (id === TITLE ? s.titleName : (s.properties.find((p) => p.id === id)?.name ?? id));
  const ready = !!other && !!name.trim() && (fn === "count" || !!prop);

  const add = () => {
    if (!other) return;
    const rel: Property = {
      id: newId("p"),
      name: other.title,
      type: "relation",
      ...(from.startsWith("source:") ? { relationSource: from.slice(7) } : { relationDb: Number(from.slice(3)) }),
      match: { from: mine, to: theirs },
    };
    const roll: Property = {
      id: newId("p"),
      name: name.trim(),
      type: "rollup",
      rollup: { relation: rel.id, property: fn === "count" ? TITLE : prop, fn, ...(filter?.rules.length ? { filter } : {}) },
      ...(target && /hour|stund/i.test(target.name) ? { format: "hours" as const } : {}),
    };
    onAdd([rel, roll], rel.id);
    onClose();
  };

  const sel = "input text-sm";
  const label = "text-xs font-semibold text-zinc-500 uppercase";
  return (
    <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-900 dark:bg-indigo-950/20">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Σ {t("Calculate from other data")}</h3>
        <button type="button" className="icon-btn" aria-label={t("Close")} onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="space-y-1">
        <div className={label}>1 · {t("Where is the data?")}</div>
        <select className={`${sel} w-full`} value={from} aria-label={t("Where is the data?")} onChange={(e) => void pick(e.target.value)}>
          <option value="">{t("Choose …")}</option>
          {sources.length > 0 && (
            <optgroup label={t("From Zeff")}>
              {sources.map((s) => (
                <option key={s.id} value={`source:${s.id}`}>
                  {s.icon} {s.label}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={t("Databases")}>
            {databases.map((d) => (
              <option key={d.id} value={`db:${d.id}`}>
                {d.id === dbId ? `${d.title} (${t("this one")})` : d.title}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      {other && (
        <>
          <div className="space-y-1">
            <div className={label}>2 · {t("Which of them belong to a row?")}</div>
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span>{t("Where")}</span>
              <select className={sel} value={theirs} aria-label={t("Value of the other data")} onChange={(e) => setTheirs(e.target.value)}>
                <option value={TITLE}>{other.schema.titleName}</option>
                {other.schema.properties.filter((p) => p.type !== "rollup" && p.type !== "formula").map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span>{t("equals this row's")}</span>
              <select className={sel} value={mine} aria-label={t("Value of this row")} onChange={(e) => setMine(e.target.value)}>
                <option value={TITLE}>{draft.titleName}</option>
                {mineProps.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <div className={label}>3 · {t("What to calculate?")}</div>
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <select className={sel} value={fn} aria-label={t("Calculate")} onChange={(e) => setFn(e.target.value as RollupFn)}>
                {FNS.map(([k, text]) => (
                  <option key={k} value={k}>
                    {text}
                  </option>
                ))}
              </select>
              {fn !== "count" && (
                <>
                  <span>{t("of")}</span>
                  <select className={sel} value={prop} aria-label={t("Property")} onChange={(e) => setProp(e.target.value)}>
                    <option value="">{t("Choose …")}</option>
                    {valueProps.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <div className={label}>4 · {t("Only some of them? (optional)")}</div>
            {filter ? (
              <>
                <FilterEditor filter={filter} schema={other.schema} data={data} onChange={setFilter} />
                <button type="button" className="text-sm text-zinc-500 hover:underline" onClick={() => setFilter(null)}>
                  {t("Count all of them")}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
                onClick={() => {
                  const first = other.schema.properties[0];
                  setFilter({ op: "and", rules: [{ prop: first?.id ?? TITLE, cond: first?.type === "date" ? "this_month" : first?.type === "number" ? "gt" : "is", value: "" }] });
                }}
              >
                + {t("Only count rows where …")}
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input className={`${sel} min-w-0 flex-1`} value={name} aria-label={t("Name")} placeholder={t("Name of the new column")} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="btn btn-primary btn-sm" disabled={!ready} onClick={add}>
              {t("Add the column")}
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            {FNS.find(([k]) => k === fn)![1]}
            {fn !== "count" && target ? ` ${t("of")} ${target.name}` : ""} {t("of the rows in")} “{other.title}” {t("where")} {nameOf(theirs, other.schema)} {t("equals this row's")} {nameOf(mine, draft)}
            {filter?.rules.length ? ` ${t("and the filter holds")}` : ""}.
          </p>
        </>
      )}
    </div>
  );
}
