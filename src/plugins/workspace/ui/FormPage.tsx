"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { submitFormAction } from "../actions";
import type { FormView } from "../form";

/** A database's form as you fill it in: the title, the fields it asks (required ones starred), "Send" makes the row. */
export function FormPage({ form }: { form: FormView }) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const asked = form.fields.filter((f) => !f.field.hidden);
  const set = (id: string, v: unknown) => setAnswers((cur) => ({ ...cur, [id]: v }));
  const send = () =>
    start(async () => {
      setError("");
      const r = await submitFormAction(form.id, title, answers);
      if (!r.ok) return setError(r.error);
      setDone(r.id);
    });

  if (done !== null)
    return (
      <div className="mx-auto max-w-xl space-y-4 py-10 text-center">
        <p className="text-4xl" aria-hidden>
          ✅
        </p>
        <p className="text-lg font-medium">{form.spec.thanks || t("Thank you — it is saved.")}</p>
        <div className="flex justify-center gap-2">
          <button type="button" className="btn btn-primary" onClick={() => (setDone(null), setTitle(""), setAnswers({}))}>
            {t("Add another")}
          </button>
          <Link href={`/workspace/${done}`} className="btn">
            {t("Open the entry")}
          </Link>
        </div>
      </div>
    );

  return (
    <form
      className="mx-auto max-w-xl space-y-4 py-6"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div>
        <h1 className="text-xl font-semibold">{form.spec.title || form.database}</h1>
        {form.spec.intro && <p className="mt-1 text-sm whitespace-pre-wrap text-zinc-500">{form.spec.intro}</p>}
      </div>
      <label className="block space-y-1">
        <span className="label">
          {form.spec.titleLabel || form.titleName}
          {form.spec.titleRequired && <span className="text-red-600"> *</span>}
        </span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>
      {asked.map(({ field, prop }) => {
        const value = answers[prop.id] ?? field.default ?? (prop.type === "multi_select" ? [] : "");
        const label = (
          <span className="label">
            {field.label || prop.name}
            {field.required && <span className="text-red-600"> *</span>}
          </span>
        );
        if (prop.type === "checkbox")
          return (
            <label key={prop.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-indigo-600" checked={value === true || value === "true" || value === "yes"} onChange={(e) => set(prop.id, e.target.checked)} />
              <span>
                {field.label || prop.name}
                {field.required && <span className="text-red-600"> *</span>}
              </span>
            </label>
          );
        if (prop.type === "select" || prop.type === "status")
          return (
            <label key={prop.id} className="block space-y-1">
              {label}
              <select className="input" value={String(prop.options?.find((o) => o.id === value || o.name.toLowerCase() === String(value).toLowerCase())?.id ?? "")} onChange={(e) => set(prop.id, e.target.value)}>
                <option value="">—</option>
                {(prop.options ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          );
        if (prop.type === "multi_select") {
          const chosen = (Array.isArray(value) ? value : String(value).split(/\s*,\s*/)).filter(Boolean).map((x) => prop.options?.find((o) => o.id === x || o.name.toLowerCase() === String(x).toLowerCase())?.id ?? x);
          return (
            <div key={prop.id} className="space-y-1">
              {label}
              <div className="flex flex-wrap gap-1.5">
                {(prop.options ?? []).map((o) => {
                  const on = chosen.includes(o.id);
                  return (
                    <button key={o.id} type="button" aria-pressed={on} className={`ws-tag ${on ? "" : "opacity-40"}`} data-color={o.color} onClick={() => set(prop.id, on ? chosen.filter((x) => x !== o.id) : [...chosen, o.id])}>
                      {o.name}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        }
        return (
          <label key={prop.id} className="block space-y-1">
            {label}
            {prop.type === "text" ? (
              <textarea className="input" rows={3} value={String(value)} onChange={(e) => set(prop.id, e.target.value)} />
            ) : (
              <input className="input" type={prop.type === "number" ? "number" : prop.type === "date" ? "date" : prop.type === "email" ? "email" : prop.type === "url" ? "url" : "text"} value={String(value)} onChange={(e) => set(prop.id, e.target.value)} />
            )}
          </label>
        );
      })}
      {error && (
        <p role="alert" className="alert-error text-sm">
          {error}
        </p>
      )}
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "…" : t("Send")}
      </button>
    </form>
  );
}
