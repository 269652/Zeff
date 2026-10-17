"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { FORM_TYPES, moveBefore, type DbSchema, type FormField, type FormSpec } from "../model";
import { Modal, useSortable } from "./kit";

/**
 * A database's form: switched on, titled, with the fields it asks in the order you drag them to - required ones starred, hidden ones
 * not asked but set on every row (a status "New") - and the link to hand out. Saved with the database (its schema).
 */
export function FormDesigner({ schema, dbId, onSave, onClose }: { schema: DbSchema; dbId: number; onSave: (s: DbSchema) => Promise<string | null>; onClose: () => void }) {
  const t = useT();
  const eligible = schema.properties.filter((p) => FORM_TYPES.includes(p.type) && !["srcref", "srcedited", "srcurl", "ticketkey", "noteref"].includes(p.id));
  const cur = schema.form;
  const [spec, setSpec] = useState<FormSpec>({ enabled: cur?.enabled ?? false, title: cur?.title ?? "", intro: cur?.intro ?? "", thanks: cur?.thanks ?? "", titleLabel: cur?.titleLabel ?? "", titleRequired: cur?.titleRequired ?? true, fields: cur?.fields ?? [] });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const used = new Set(spec.fields.map((f) => f.prop));
  const patch = (prop: string, p: Partial<FormField>) => setSpec((s) => ({ ...s, fields: s.fields.map((f) => (f.prop === prop ? { ...f, ...p } : f)) }));
  const sort = useSortable((from, to, after) => setSpec((s) => ({ ...s, fields: moveBefore(s.fields.map((f) => f.prop), from, to, after).map((id) => s.fields.find((f) => f.prop === id)!) })));
  const link = typeof window === "undefined" ? `/form/${dbId}` : `${window.location.origin}/form/${dbId}`;

  return (
    <Modal title={t("Form")} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-indigo-600" checked={spec.enabled} onChange={(e) => setSpec({ ...spec, enabled: e.target.checked })} />
          <span className="font-medium">{t("The form is on")}</span>
        </label>
        {spec.enabled && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-zinc-50 p-2 dark:bg-zinc-900">
            <code className="min-w-0 flex-1 truncate text-xs">{link}</code>
            <button type="button" className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(link).then(() => toast(t("Link copied."), { tone: "ok" }))}>
              {t("Copy the link")}
            </button>
            <a className="btn btn-sm" href={`/form/${dbId}`} target="_blank" rel="noreferrer">
              {t("Open the form")}
            </a>
            <p className="w-full text-xs text-zinc-500">{t("Anyone who can open this Zeff (and is signed in to it) can fill it in.")}</p>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="label">{t("Title of the form")}</span>
            <input className="input text-sm" value={spec.title} onChange={(e) => setSpec({ ...spec, title: e.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="label">{t("Name of the first field")}</span>
            <input className="input text-sm" value={spec.titleLabel} onChange={(e) => setSpec({ ...spec, titleLabel: e.target.value })} placeholder={schema.titleName} />
          </label>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-indigo-600" checked={spec.titleRequired} onChange={(e) => setSpec({ ...spec, titleRequired: e.target.checked })} />
          {t("The first field is required")}
        </label>
        <label className="block space-y-1">
          <span className="label">{t("Introduction")}</span>
          <textarea className="input text-sm" rows={2} value={spec.intro} onChange={(e) => setSpec({ ...spec, intro: e.target.value })} />
        </label>
        <label className="block space-y-1">
          <span className="label">{t("Message after sending")}</span>
          <input className="input text-sm" value={spec.thanks} onChange={(e) => setSpec({ ...spec, thanks: e.target.value })} placeholder={t("Thank you — it is saved.")} />
        </label>

        <div>
          <p className="label">{t("Fields")}</p>
          <ul className="space-y-1.5">
            {spec.fields.map((f) => {
              const p = schema.properties.find((x) => x.id === f.prop);
              if (!p) return null;
              return (
                <li key={f.prop} className={`flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-700 ${sort.mark(f.prop)}`} {...sort.target(f.prop)}>
                  <span className="cursor-grab px-0.5 text-zinc-400" title={t("Drag to move")} {...sort.handle(f.prop)}>
                    ⠿
                  </span>
                  <span className="w-28 truncate font-medium" title={p.name}>
                    {p.name}
                  </span>
                  <input className="input w-36 py-0.5 text-xs" value={f.label ?? ""} onChange={(e) => patch(f.prop, { label: e.target.value })} placeholder={t("Label")} aria-label={t("Label")} />
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={!!f.required} disabled={!!f.hidden} onChange={(e) => patch(f.prop, { required: e.target.checked })} /> {t("Required")}
                  </label>
                  <label className="flex items-center gap-1 text-xs" title={t("Not asked — its prefilled value is set on every row")}>
                    <input type="checkbox" checked={!!f.hidden} onChange={(e) => patch(f.prop, { hidden: e.target.checked, required: false })} /> {t("Hidden")}
                  </label>
                  {p.type === "select" || p.type === "status" ? (
                    <select className="input w-36 py-0.5 text-xs" value={f.default ?? ""} onChange={(e) => patch(f.prop, { default: e.target.value })} aria-label={t("Prefilled")}>
                      <option value="">{t("Prefilled: nothing")}</option>
                      {(p.options ?? []).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="input w-36 py-0.5 text-xs" value={f.default ?? ""} onChange={(e) => patch(f.prop, { default: e.target.value })} placeholder={t("Prefilled")} aria-label={t("Prefilled")} />
                  )}
                  <button type="button" className="icon-btn ml-auto" onClick={() => setSpec({ ...spec, fields: spec.fields.filter((x) => x.prop !== f.prop) })} aria-label={t("Remove the field")}>
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
          {eligible.some((p) => !used.has(p.id)) && (
            <select className="input mt-2 w-auto text-sm" value="" onChange={(e) => e.target.value && setSpec({ ...spec, fields: [...spec.fields, { prop: e.target.value }] })} aria-label={t("Add a field")}>
              <option value="">＋ {t("Add a field …")}</option>
              {eligible.filter((p) => !used.has(p.id)).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {err && (
          <p role="alert" className="alert-error">
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
              setBusy(true);
              const e = await onSave({ ...schema, form: spec });
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
