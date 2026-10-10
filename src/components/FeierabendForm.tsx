"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bookDayAction } from "@/app/actions";
import type { DayRow } from "@/lib/feierabend";
import { toast } from "./Toaster";

const KIND_LABELS: Record<DayRow["kind"], string> = { meeting: "Termin", suggestion: "Vorschlag", ticket: "Ticket" };
const fmt = (h: number) => h.toLocaleString("de-DE", { maximumFractionDigits: 2 });

/**
 * The day's proposal to take over: each line ticked or not, its hours, job and words to change —
 * "Rest verteilen" spreads what's missing to the target over the ticket lines without hours; one
 * click books it all.
 */
export function FeierabendForm({ date, target, booked, rows: initial, jobs }: { date: string; target: number; booked: number; rows: DayRow[]; jobs: { number: string; name: string }[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const set = (id: string, patch: Partial<DayRow>) => setRows((l) => l.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.include);
  const sum = chosen.reduce((s, r) => s + (r.hours ?? 0), 0);
  const missing = Math.max(0, Math.round((target - booked - sum) * 100) / 100);
  // What's missing to the target, on the ticked ticket lines without hours — in quarter hours.
  const spread = () => {
    const open = rows.filter((r) => r.include && r.kind === "ticket" && !r.hours);
    const pool = open.length ? open : rows.filter((r) => r.include && r.kind === "ticket");
    if (!pool.length || !missing) return;
    const each = Math.max(0.25, Math.round((missing / pool.length) * 4) / 4);
    setRows((l) => l.map((r) => (pool.some((p) => p.id === r.id) ? { ...r, hours: Math.round(((open.length ? 0 : (r.hours ?? 0)) + each) * 100) / 100 } : r)));
  };
  const book = () =>
    start(async () => {
      const r = await bookDayAction(
        date,
        chosen.map((x) => ({ kind: x.kind, hours: x.hours ?? 0, jobNumber: x.jobNumber, description: x.description, ticket: x.ticket, externalId: x.externalId, suggestionId: x.suggestionId })),
      );
      toast(r?.ok ? (r.message ?? "Gebucht.") : (r?.error ?? "Ging nicht."), { tone: r?.ok ? "ok" : "error" });
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <span>
          Gebucht <b className="tabular-nums">{fmt(booked)}</b> h
        </span>
        <span>
          + ausgewählt <b className="tabular-nums">{fmt(sum)}</b> h
        </span>
        <span className={booked + sum >= target ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
          = <b className="tabular-nums">{fmt(booked + sum)}</b> von {fmt(target)} h{missing ? ` — es fehlen ${fmt(missing)} h` : ""}
        </span>
        <span className="ml-auto flex gap-2">
          <button type="button" className="btn btn-sm" disabled={pending || !missing || !rows.some((r) => r.include && r.kind === "ticket")} onClick={spread} title="Die fehlenden Stunden auf die angehakten Ticket-Zeilen ohne Stunden verteilen (Viertelstunden)">
            Rest verteilen
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={pending || !chosen.length || chosen.some((r) => !r.hours || (r.kind !== "suggestion" && !r.jobNumber))} onClick={book}>
            {pending ? "Bucht…" : `${chosen.length} Zeile${chosen.length === 1 ? "" : "n"} buchen`}
          </button>
        </span>
      </div>

      {rows.length ? (
        <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 ${r.include ? "" : "opacity-60"}`}>
              <input type="checkbox" className="size-4" checked={r.include} onChange={(e) => set(r.id, { include: e.target.checked })} aria-label={`${r.description} buchen`} />
              <span className="w-20 shrink-0 text-xs text-zinc-500">{KIND_LABELS[r.kind]}</span>
              <input
                type="number"
                step={0.25}
                min={0}
                max={24}
                className="input num w-20"
                value={r.hours ?? ""}
                placeholder="h"
                aria-label="Stunden"
                onChange={(e) => set(r.id, { hours: e.target.value === "" ? null : Number(e.target.value) })}
              />
              {r.kind === "suggestion" ? (
                <span className="w-44 shrink-0 truncate text-xs text-zinc-500">{r.jobNumber || "Job des Vorschlags"}</span>
              ) : (
                <select className="input w-44" value={r.jobNumber} aria-label="Job" onChange={(e) => set(r.id, { jobNumber: e.target.value })}>
                  <option value="">Job wählen…</option>
                  {jobs.map((j) => (
                    <option key={j.number} value={j.number}>
                      {j.number} · {j.name}
                    </option>
                  ))}
                </select>
              )}
              <input className="input min-w-0 flex-1 basis-60" value={r.description} aria-label="Beschreibung" onChange={(e) => set(r.id, { description: e.target.value })} />
              <span className="w-full pl-[7.5rem] text-xs text-zinc-400">
                {r.ticket && <span className="font-mono">{r.ticket} · </span>}
                {r.from}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-zinc-500">Nichts vorzuschlagen — keine offenen Termine, Vorschläge oder bearbeiteten Tickets von heute.</p>
      )}
    </div>
  );
}
