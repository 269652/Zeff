"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { FormRun } from "../forms";
import { FormDesigner } from "./form-designer";
import { FormRunner } from "./form-runner";

/**
 * A form's page: the designer (unlocked), or the form as it is filled in ("Fill in" — what is sent makes a real row), and where
 * its rows go. Its own address (/form/<id>) shows it without the Workspace around it — the link to hand out.
 */
export function FormPageBody({ initial, editable }: { initial: FormRun; editable: boolean }) {
  const t = useT();
  const [form, setForm] = useState(initial);
  const [mode, setMode] = useState<"design" | "fill">(editable ? "design" : "fill");
  // (A new key per visit of "Fill in": it starts empty with what the designer has now.)
  const [run, setRun] = useState(0);
  const link = typeof window === "undefined" ? `/form/${form.id}` : `${window.location.origin}/form/${form.id}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {editable && (
          <div className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700" role="group" aria-label={t("Mode")}>
            {(
              [
                ["design", t("Design")],
                ["fill", t("Fill in")],
              ] as const
            ).map(([m, label]) => (
              <button key={m} type="button" aria-pressed={mode === m} className={`rounded px-2.5 py-1 ${mode === m ? "bg-indigo-600 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`} onClick={() => (setMode(m), m === "fill" && setRun((n) => n + 1))}>
                {label}
              </button>
            ))}
          </div>
        )}
        {form.db && (
          <span className="text-zinc-500">
            {t("Entries go to")}{" "}
            <Link href={`/workspace/${form.db.id}`} className="text-indigo-700 hover:underline dark:text-indigo-400">
              {form.db.title}
            </Link>
          </span>
        )}
        <span className="ml-auto flex gap-2">
          <button type="button" className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(link).then(() => toast(t("Link copied."), { tone: "ok" }))}>
            {t("Copy the link")}
          </button>
          <a className="btn btn-sm" href={`/form/${form.id}`} target="_blank" rel="noreferrer">
            {t("Open the form")}
          </a>
        </span>
      </div>
      {mode === "design" && editable ? (
        <FormDesigner initial={form} onChange={setForm} />
      ) : (
        <div className="card mx-auto max-w-2xl p-6">
          <FormRunner key={run} form={form} />
        </div>
      )}
    </div>
  );
}
