"use client";

import { useState, useTransition } from "react";
import { diagnosticsAction } from "@/app/actions";
import { useT } from "@/components/I18nProvider";
import { toast } from "./Toaster";

/** Makes the diagnostics report, shows it for reading, and lets you copy or save it — nothing is sent. */
export function DiagnosticsView() {
  const t = useT();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await diagnosticsAction();
              if (r.ok) setText(r.text ?? "");
              else toast(r.error ?? t("Didn't work."), { tone: "error" });
            })
          }
        >
          {pending ? t("Collecting …") : text ? t("Make it again") : t("Make the report")}
        </button>
        {text && (
          <>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void navigator.clipboard.writeText(text).then(() => toast(t("Copied.")), () => toast(t("Couldn't copy — select the text and copy it."), { tone: "error" }))}
            >
              {t("Copy")}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
                const a = Object.assign(document.createElement("a"), { href: url, download: `zeff-diagnostics-${new Date().toISOString().slice(0, 10)}.txt` });
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              {t("Save as file")}
            </button>
          </>
        )}
      </div>
      {text && <textarea readOnly value={text} aria-label={t("Diagnostics")} className="h-[60vh] w-full rounded border border-zinc-200 bg-white p-3 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-900" />}
    </div>
  );
}
