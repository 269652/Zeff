"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { CALENDAR_COLORS, SOURCE_LABELS, type CalendarView } from "@/lib/calendar/ir-shared";
import { createCalendarAction, deleteCalendarAction, saveGoogleCalendarSettingsAction, syncCalendarsAction, updateCalendarAction } from "./server-actions";

function Colors({ value, onChange, disabled }: { value: string; onChange: (c: string) => void; disabled?: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Farbe">
      {CALENDAR_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === c.toLowerCase()}
          aria-label={c}
          disabled={disabled}
          onClick={() => onChange(c)}
          className={`size-5 rounded-full ring-offset-2 dark:ring-offset-zinc-900 ${value.toLowerCase() === c.toLowerCase() ? "ring-2 ring-zinc-500" : "opacity-70 hover:opacity-100"}`}
          style={{ background: c }}
        />
      ))}
    </span>
  );
}

/** The calendars' settings: each one's colour and switches, Zeff's own made and removed, Google's account. */
export function CalendarSettings({ calendars, google, outlook }: { calendars: CalendarView[]; google: { account: string; weeks: number } | null; outlook: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [fresh, setFresh] = useState({ name: "", color: CALENDAR_COLORS[0] });
  const [names, setNames] = useState<Record<number, string>>(() => Object.fromEntries(calendars.map((c) => [c.id, c.name])));
  const [g, setG] = useState(google ?? { account: "0", weeks: 5 });
  const done = (r: { ok: boolean; message?: string; error?: string } | null) => {
    toast(r?.ok ? (r.message ?? "Erledigt.") : (r?.error ?? "Ging nicht."), { tone: r?.ok ? "ok" : "error" });
    if (r?.ok) router.refresh();
    return !!r?.ok;
  };
  const save = (c: CalendarView, patch: Parameters<typeof updateCalendarAction>[1]) => start(async () => void done(await updateCalendarAction(c.id, patch)));

  return (
    <div className="space-y-6">
      {(["zeff", "google", "outlook"] as const).map((src) => {
        const list = calendars.filter((c) => c.source === src);
        if (src === "google" && !google && !list.length) return null;
        if (src === "outlook" && !outlook && !list.length) return null;
        return (
          <section key={src} className="space-y-2">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase">{src === "zeff" ? "Meine Kalender (Zeff)" : SOURCE_LABELS[src]}</h2>
            <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
              {list.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: c.color }} />
                  {src === "zeff" ? (
                    <input
                      className="input min-w-0 flex-1 basis-40"
                      value={names[c.id] ?? c.name}
                      onChange={(e) => setNames({ ...names, [c.id]: e.target.value })}
                      onBlur={() => names[c.id] !== c.name && save(c, { name: names[c.id] })}
                      aria-label="Name"
                    />
                  ) : (
                    <span className="min-w-0 flex-1 basis-40 truncate font-medium">{c.name}</span>
                  )}
                  <Colors value={c.color} disabled={pending} onChange={(color) => save(c, { color })} />
                  <label className="flex items-center gap-1" title="Im Kalender zeigen">
                    <input type="checkbox" checked={c.visible} disabled={pending} onChange={(e) => save(c, { visible: e.target.checked })} /> Zeigen
                  </label>
                  <label className="flex items-center gap-1" title="Seine Termine zählen für freie Zeiten und Terminvorschläge">
                    <input type="checkbox" checked={c.busy} disabled={pending} onChange={(e) => save(c, { busy: e.target.checked })} /> Belegt
                  </label>
                  <label className="flex items-center gap-1" title="Seine Meetings erscheinen unter Termine buchen (Zeiterfassung)">
                    <input type="checkbox" checked={c.book} disabled={pending} onChange={(e) => save(c, { book: e.target.checked })} /> Buchen
                  </label>
                  {src === "zeff" && (
                    <button
                      type="button"
                      className="btn btn-sm text-red-600 dark:text-red-400"
                      disabled={pending}
                      onClick={() => {
                        if (confirm(`Kalender „${c.name}“ mit allen Terminen löschen?`)) start(async () => void done(await deleteCalendarAction(c.id)));
                      }}
                    >
                      Löschen
                    </button>
                  )}
                </li>
              ))}
              {!list.length && (
                <li className="px-4 py-3 text-sm text-zinc-500">
                  {src === "zeff" ? "Noch keiner — leg unten einen an." : src === "google" ? "Noch nichts gelesen — „Jetzt syncen“." : "Noch nichts gelesen — der Outlook-Kalender-Sync bringt ihn (Sync-Menü)."}
                </li>
              )}
            </ul>
            {src === "zeff" && (
              <form
                className="card flex flex-wrap items-center gap-3 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  start(async () => {
                    if (done(await createCalendarAction(fresh.name, fresh.color))) setFresh({ name: "", color: CALENDAR_COLORS[0] });
                  });
                }}
              >
                <input className="input min-w-0 flex-1 basis-40" placeholder="Neuer Kalender, z. B. Privat" value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} />
                <Colors value={fresh.color} onChange={(color) => setFresh({ ...fresh, color })} />
                <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !fresh.name.trim()}>
                  Anlegen
                </button>
              </form>
            )}
            {src === "google" && google && (
              <div className="card flex flex-wrap items-end gap-3 p-3 text-sm">
                <label className="space-y-1">
                  <span className="block text-xs text-zinc-500">Google-Konto (Nummer u/0, u/1 … oder Adresse)</span>
                  <input className="input w-48" value={g.account} onChange={(e) => setG({ ...g, account: e.target.value })} />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs text-zinc-500">Wochen lesen</span>
                  <input type="number" min={1} max={12} className="input w-20" value={g.weeks} onChange={(e) => setG({ ...g, weeks: Number(e.target.value) })} />
                </label>
                <button type="button" className="btn btn-sm" disabled={pending} onClick={() => start(async () => void done(await saveGoogleCalendarSettingsAction(g)))}>
                  Speichern
                </button>
                <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => start(async () => void done(await syncCalendarsAction()))}>
                  {pending ? "Liest …" : "Jetzt syncen"}
                </button>
                <span className="text-xs text-zinc-500">
                  Liest im Automations-Chrome dieses Kontos — angemeldet?{" "}
                  <Link href="/logins" className="text-indigo-600 hover:underline dark:text-indigo-400">
                    Anmeldungen
                  </Link>
                </span>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
