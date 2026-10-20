"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { recurrencesAction, removeRecurrenceAction, saveRecurrenceAction } from "../actions";
import type { Recurrence } from "../recurring";
import type { DbSchema } from "../model";
import { Modal } from "./kit";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

/** Rows that come back by themselves: the rules of this database (from a row template, every N days / weeks / months) and a form for a new one. */
export function RecurringDialog({ dbId, schema, templates, onClose }: { dbId: number; schema: DbSchema; templates: { id: number; title: string }[]; onClose: () => void }) {
  const t = useT();
  const [rules, setRules] = useState<Recurrence[]>([]);
  const [err, setErr] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ unit: "week" as Recurrence["unit"], interval: 1, weekdays: [1] as number[], at: "08:00", start: today, templateId: 0, title: "", dateProp: "" });
  const dates = schema.properties.filter((p) => p.type === "date");
  const dayNames = [t("Sun"), t("Mon"), t("Tue"), t("Wed"), t("Thu"), t("Fri"), t("Sat")];

  const load = useCallback(async () => {
    const r = await recurrencesAction(dbId);
    if (r.ok) setRules(r.rules);
  }, [dbId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read when shown (the state is set once the answer is there)
  useEffect(() => void load(), [load]);

  const describe = (r: Recurrence) =>
    `${r.unit === "day" ? t("every {n} day(s)", { n: r.interval }) : r.unit === "week" ? `${t("every {n} week(s)", { n: r.interval })} ${r.weekdays?.length ? r.weekdays.map((d) => dayNames[d]).join(" ") : ""}` : t("every {n} month(s)", { n: r.interval })} · ${r.at}`;

  return (
    <Modal title={t("Repeating rows")} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <p className="text-zinc-500">{t("A row is made by itself when it is due — from a row template (its {{date}}, {{week}}, {{month}} and {{weekday}} are filled in), with the day in a date field. If Zeff was off, one row is made, not one per missed day.")}</p>
        {rules.length > 0 && (
          <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{r.title || templates.find((x) => x.id === r.templateId)?.title || t("Untitled")}</span>
                  <span className="block text-xs text-zinc-500">
                    {describe(r)} · {t("next")} {new Date(r.nextAt).toLocaleString()}
                  </span>
                </span>
                <button type="button" className="btn btn-sm" onClick={async () => (await saveRecurrenceAction({ ...r, paused: !r.paused }), load())}>
                  {r.paused ? t("Resume") : t("Pause")}
                </button>
                <button type="button" className="icon-btn" aria-label={t("Remove")} onClick={async () => (await removeRecurrenceAction(r.id), load())}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2 rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center gap-2">
            {t("Every")}
            <input type="number" min={1} max={365} className="input w-16 py-0.5" value={f.interval} onChange={(e) => setF({ ...f, interval: Number(e.target.value) || 1 })} aria-label={t("Interval")} />
            <select className="input w-auto py-0.5" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as Recurrence["unit"] })} aria-label={t("Unit")}>
              <option value="day">{t("day(s)")}</option>
              <option value="week">{t("week(s)")}</option>
              <option value="month">{t("month(s) (the day of the start)")}</option>
            </select>
            {t("at")}
            <input type="time" className="input w-auto py-0.5" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} aria-label={t("Time")} />
          </div>
          {f.unit === "week" && (
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => (
                <button key={d} type="button" aria-pressed={f.weekdays.includes(d)} className={`ws-tag ${f.weekdays.includes(d) ? "" : "opacity-40"}`} onClick={() => setF({ ...f, weekdays: f.weekdays.includes(d) ? f.weekdays.filter((x) => x !== d) : [...f.weekdays, d] })}>
                  {dayNames[d]}
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="label">{t("Row template")}</span>
              <select className="input" value={f.templateId} onChange={(e) => setF({ ...f, templateId: Number(e.target.value) })}>
                <option value={0}>{t("— none (only a title)")}</option>
                {templates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="label">{t("Title (when it differs from the template's)")}</span>
              <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </label>
            <label className="block space-y-1">
              <span className="label">{t("Date field set to the day")}</span>
              <select className="input" value={f.dateProp} onChange={(e) => setF({ ...f, dateProp: e.target.value })}>
                <option value="">—</option>
                {dates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="label">{t("Starts")}</span>
              <input type="date" className="input" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
            </label>
          </div>
          {err && (
            <p role="alert" className="alert-error">
              {err}
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!f.templateId && !f.title.trim()}
            onClick={async () => {
              setErr("");
              const r = await saveRecurrenceAction({ db: dbId, unit: f.unit, interval: f.interval, at: f.at, start: f.start, weekdays: f.unit === "week" ? f.weekdays : undefined, templateId: f.templateId || undefined, title: f.title || undefined, dateProp: f.dateProp || undefined });
              if (!r.ok) return setErr(r.error);
              setF({ ...f, title: "" });
              void load();
            }}
          >
            {t("Add the rule")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
