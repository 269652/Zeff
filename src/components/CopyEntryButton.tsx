"use client";

import { useState, useTransition } from "react";
import { copyEntryAction } from "@/app/actions";
import { useT } from "@/components/I18nProvider";
import { CopyIcon } from "./icons";
import { isoDate } from "@/lib/week";

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + 1);
  // The local day (toISOString is UTC: in Germany the day before).
  return Number.isNaN(d.getTime()) ? iso : isoDate(d);
}

/** Copy an entry to another day: a "Copy" button that reveals a date + confirm. */
export function CopyEntryButton({ entryId, date }: { entryId: number; date: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(() => nextDay(date));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.set("id", String(entryId));
    fd.set("date", target);
    start(async () => {
      const r = await copyEntryAction(null, fd);
      if (r?.ok) setOpen(false);
      else setError(r?.error ?? t("Could not copy."));
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        className="icon-btn"
        onClick={() => setOpen(true)}
        title={t("Copy this entry to another day")}
        aria-label={t("Copy this entry to another day")}
      >
        <CopyIcon />
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="date"
        className="input num w-36 py-1 text-sm"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        aria-label={t("Copy to day")}
        autoFocus
      />
      <button type="button" className="btn btn-sm btn-primary" onClick={submit} disabled={pending}>
        {pending ? "…" : t("Copy")}
      </button>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(false)} aria-label={t("Cancel")}>
        ✕
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
