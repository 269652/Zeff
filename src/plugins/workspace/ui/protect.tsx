"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { isComputed, type DbSchema, type Protect } from "../model";
import { Modal } from "./kit";

/** What may be done to a database's rows: locked for everyone, what the AI may do (nothing / only add), and the fields whose values may not repeat. */
export function ProtectDialog({ schema, onSave, onClose }: { schema: DbSchema; onSave: (s: DbSchema) => Promise<string | null>; onClose: () => void }) {
  const t = useT();
  const [rule, setRule] = useState<Protect>(schema.protect ?? {});
  const [err, setErr] = useState("");
  const fields = [{ id: "title", name: schema.titleName }, ...schema.properties.filter((p) => !isComputed(p) && !["relation", "person", "todo", "ai"].includes(p.type) && !["srcref", "srcedited", "srcurl", "ticketkey", "noteref"].includes(p.id))];
  const unique = new Set(rule.unique ?? []);
  return (
    <Modal title={t("Protection")} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 size-4 accent-indigo-600" checked={!!rule.lock} onChange={(e) => setRule({ ...rule, lock: e.target.checked || undefined })} />
          <span>
            <span className="font-medium">{t("Locked")}</span>
            <span className="block text-xs text-zinc-500">{t("No row can be added, changed or removed — by you, the AI or an automation. A source that fills the database still writes its own records.")}</span>
          </span>
        </label>
        <label className="block space-y-1">
          <span className="label">{t("What the AI may do here")}</span>
          <select className="input" value={rule.ai ?? ""} onChange={(e) => setRule({ ...rule, ai: (e.target.value || undefined) as Protect["ai"] })}>
            <option value="">{t("Everything you may")}</option>
            <option value="append">{t("Only add rows")}</option>
            <option value="read">{t("Nothing (read only)")}</option>
          </select>
        </label>
        <div className="space-y-1">
          <span className="label">{t("Values that may not repeat")}</span>
          <div className="flex flex-wrap gap-1.5">
            {fields.map((f) => (
              <button key={f.id} type="button" aria-pressed={unique.has(f.id)} className={`ws-tag ${unique.has(f.id) ? "" : "opacity-40"}`} onClick={() => setRule({ ...rule, unique: unique.has(f.id) ? [...unique].filter((x) => x !== f.id) : [...unique, f.id] })}>
                {f.name}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500">{t("A row whose value is already taken is refused — empty values never clash.")}</p>
        </div>
        {err && (
          <p role="alert" className="alert-error">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              const clean: Protect = { ...(rule.lock ? { lock: true } : {}), ...(rule.ai ? { ai: rule.ai } : {}), ...(rule.unique?.length ? { unique: rule.unique } : {}) };
              const e = await onSave({ ...schema, protect: Object.keys(clean).length ? clean : undefined });
              if (e) return setErr(e);
              onClose();
            }}
          >
            {t("Save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
