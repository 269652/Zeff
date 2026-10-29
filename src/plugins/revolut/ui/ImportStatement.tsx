"use client";

import { useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { importStatementAction } from "../server-actions";

/** A statement (CSV — Revolut's export or your bank's) read from a file into the cases' bank. */
export function ImportStatement({ onDone }: { onDone: (r: { ok: boolean; message?: string; error?: string }) => void }) {
  const t = useT();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const read = async (list: FileList | null) => {
    const one = list?.[0];
    if (!one) return;
    setBusy(true);
    const r = await importStatementAction(await one.text(), one.name);
    setBusy(false);
    onDone(r);
    if (file.current) file.current.value = "";
  };
  return (
    <>
      <input ref={file} type="file" accept=".csv,text/csv" className="hidden" aria-hidden tabIndex={-1} onChange={(e) => void read(e.target.files)} />
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => file.current?.click()}>
        {busy ? "…" : t("Import statement (CSV)")}
      </button>
    </>
  );
}
