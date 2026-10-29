"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { createEntryFormAction, formAction, formsAction, setEntryFormAction } from "../actions";
import type { FormRun } from "../forms";
import { Modal } from "./kit";
import { FormRunner } from "./form-runner";

/**
 * A database's entry form: set in its menu (none, or one of the forms that fill it — or a new one made for it), and then what its
 * "New" opens — the form in a dialog (the focus kept in it, Escape closes it); sent, the row is there.
 */

export function EntryFormSettings({ dbId, current, onClose, onSaved }: { dbId: number; current: number | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const router = useRouter();
  const [forms, setForms] = useState<{ id: number; title: string }[] | null>(null);
  const [pick, setPick] = useState<number | null>(current);
  const [err, setErr] = useState("");
  useEffect(() => {
    void formsAction(dbId).then((r) => setForms(r.ok ? r.forms : []));
  }, [dbId]);
  const save = async () => {
    const r = await setEntryFormAction(dbId, pick);
    if (!r.ok) return setErr(r.error);
    onSaved();
    onClose();
  };
  return (
    <Modal title={t("Entry form")} onClose={onClose}>
      <form
        className="space-y-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-zinc-500">{t("With an entry form, “New” opens the form instead of an empty row.")}</p>
        <fieldset className="space-y-1.5">
          <legend className="sr-only">{t("Entry form")}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="entry-form" className="accent-indigo-600" checked={pick === null} onChange={() => setPick(null)} />
            {t("None — “New” makes an empty row")}
          </label>
          {(forms ?? []).map((f) => (
            <label key={f.id} className="flex items-center gap-2">
              <input type="radio" name="entry-form" className="accent-indigo-600" checked={pick === f.id} onChange={() => setPick(f.id)} />
              📝 {f.title}
            </label>
          ))}
          {forms === null && <p className="text-zinc-400">…</p>}
        </fieldset>
        <button
          type="button"
          className="btn btn-sm"
          onClick={async () => {
            const r = await createEntryFormAction(dbId);
            if (!r.ok) return setErr(r.error);
            onSaved();
            onClose();
            router.push(`/workspace/${r.id}`);
          }}
        >
          ＋ {t("Create one …")}
        </button>
        {err && (
          <p role="alert" className="alert-error">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button className="btn btn-primary btn-sm">{t("Save")}</button>
        </div>
      </form>
    </Modal>
  );
}

/** The entry form in a dialog: `onDone` hears of the row it made (the dialog is closed then). */
export function EntryDialog({ formId, onClose, onDone }: { formId: number; onClose: () => void; onDone: (rowId: number) => void }) {
  const t = useT();
  const [form, setForm] = useState<FormRun | null>(null);
  useEffect(() => {
    void formAction(formId).then((r) => (r.ok ? setForm(r.form) : (toast(r.error, { tone: "error" }), onClose())));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loaded once per form
  }, [formId]);
  return (
    <Modal title={form?.def.title || form?.title || t("New entry")} onClose={onClose} wide>
      {form ? <FormRunner form={form} heading={false} headingLevel={2} onCancel={onClose} onDone={onDone} /> : <p className="text-sm text-zinc-400">…</p>}
    </Modal>
  );
}
