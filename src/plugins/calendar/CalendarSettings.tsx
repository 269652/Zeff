"use client";

import { confirmAction } from "@/components/confirm";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { CALENDAR_COLORS, SOURCE_LABELS, type CalendarView } from "@/lib/calendar/ir-shared";
import { createCalendarAction, deleteCalendarAction, saveGoogleCalendarSettingsAction, syncCalendarsAction, updateCalendarAction } from "./server-actions";

function Colors({ value, onChange, disabled }: { value: string; onChange: (c: string) => void; disabled?: boolean }) {
  const t = useT();
  return (
    <span className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={t("Colour")}>
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
export function CalendarSettings({
  calendars,
  google,
  signedIn,
  outlook,
}: {
  calendars: CalendarView[];
  google: { account: string; weeks: number; pastMonths: number } | null;
  /** The Google accounts signed in in the automation Chrome (null: Chrome isn't running). */
  signedIn: { email: string; name: string; number: number }[] | null;
  outlook: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [fresh, setFresh] = useState({ name: "", color: CALENDAR_COLORS[0] });
  const [names, setNames] = useState<Record<number, string>>(() => Object.fromEntries(calendars.map((c) => [c.id, c.name])));
  const [g, setG] = useState(google ?? { account: "0", weeks: 5, pastMonths: 3 });
  const done = (r: { ok: boolean; message?: string; error?: string } | null) => {
    toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("That didn't work.")), { tone: r?.ok ? "ok" : "error" });
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
            <h2 className="text-sm font-semibold text-zinc-500 uppercase">{src === "zeff" ? t("My calendars (Zeff)") : SOURCE_LABELS[src]}</h2>
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
                      aria-label={t("Name")}
                    />
                  ) : (
                    <span className="min-w-0 flex-1 basis-40 truncate font-medium">{c.name}</span>
                  )}
                  <Colors value={c.color} disabled={pending} onChange={(color) => save(c, { color })} />
                  <label className="flex items-center gap-1" title={t("Show in the calendar")}>
                    <input type="checkbox" checked={c.visible} disabled={pending} onChange={(e) => save(c, { visible: e.target.checked })} /> {t("Show")}
                  </label>
                  <label className="flex items-center gap-1" title={t("Its events count for free slots and meeting suggestions")}>
                    <input type="checkbox" checked={c.busy} disabled={pending} onChange={(e) => save(c, { busy: e.target.checked })} /> {t("Busy")}
                  </label>
                  <label className="flex items-center gap-1" title={t("Its meetings show under Book meetings (time tracking)")}>
                    <input type="checkbox" checked={c.book} disabled={pending} onChange={(e) => save(c, { book: e.target.checked })} /> {t("Book")}
                  </label>
                  <label className="flex items-center gap-1" title={t("Its appointments become todos on their day (today's and tomorrow's), due then")}>
                    <input type="checkbox" checked={c.todos} disabled={pending} onChange={(e) => save(c, { todos: e.target.checked })} /> {t("Todos")}
                  </label>
                  {src === "zeff" && (
                    <button
                      type="button"
                      className="btn btn-sm text-red-600 dark:text-red-400"
                      disabled={pending}
                      onClick={() => {
                        if (confirmAction(t("Delete the calendar “{name}” with all its events?", { name: c.name }))) start(async () => void done(await deleteCalendarAction(c.id)));
                      }}
                    >
                      {t("Delete")}
                    </button>
                  )}
                </li>
              ))}
              {!list.length && (
                <li className="px-4 py-3 text-sm text-zinc-500">
                  {src === "zeff"
                    ? t("None yet — create one below.")
                    : src === "google"
                      ? t("Nothing read yet — “Sync now”.")
                      : t("Nothing read yet — the Outlook calendar sync brings it (Sync menu).")}
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
                <input className="input min-w-0 flex-1 basis-40" aria-label={t("New calendar name")} placeholder={t("New calendar, e.g. Personal")} value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} />
                <Colors value={fresh.color} onChange={(color) => setFresh({ ...fresh, color })} />
                <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !fresh.name.trim()}>
                  {t("Create")}
                </button>
              </form>
            )}
            {src === "google" && google && (
              <div className="card flex flex-wrap items-end gap-3 p-3 text-sm">
                {(() => {
                  // The account set: by its address, or Google's number (u/0 …) — named as Google names it.
                  const linked = signedIn?.find((a) => a.email === g.account.toLowerCase() || String(a.number) === g.account) ?? null;
                  return (
                    <>
                      <p className="w-full text-sm">
                        {linked ? (
                          <>
                            {t("Linked:")} <span className="font-medium">{linked.name || linked.email}</span> <span className="text-zinc-500">&lt;{linked.email}&gt;</span>
                          </>
                        ) : signedIn ? (
                          <span className="text-amber-700 dark:text-amber-400">{t("Account “{account}” isn't signed in in the automation Chrome.", { account: g.account })}</span>
                        ) : (
                          <span className="text-zinc-500">{t("The automation Chrome isn't running — which Google account is signed in shows once it is.")}</span>
                        )}
                      </p>
                      <label className="space-y-1">
                        <span className="block text-xs text-zinc-500">{t("Google account")}</span>
                        {signedIn?.length ? (
                          <select className="input w-72" value={linked?.email ?? g.account} onChange={(e) => setG({ ...g, account: e.target.value })}>
                            {!linked && <option value={g.account}>{g.account}</option>}
                            {signedIn.map((a) => (
                              <option key={a.email} value={a.email}>
                                {a.name ? `${a.name} <${a.email}>` : a.email}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input className="input w-48" value={g.account} onChange={(e) => setG({ ...g, account: e.target.value })} placeholder={t("0 or an address")} />
                        )}
                      </label>
                    </>
                  );
                })()}
                <label className="space-y-1">
                  <span className="block text-xs text-zinc-500">{t("Weeks to read")}</span>
                  <input type="number" min={1} max={12} className="input w-20" value={g.weeks} onChange={(e) => setG({ ...g, weeks: Number(e.target.value) })} />
                </label>
                <label className="space-y-1" title={t("Read from the 1st of the month so many months back (through Google's API). An older month: open it in the calendar and press Sync.")}>
                  <span className="block text-xs text-zinc-500">{t("Months back")}</span>
                  <input type="number" min={0} max={24} className="input w-20" value={g.pastMonths} onChange={(e) => setG({ ...g, pastMonths: Number(e.target.value) })} />
                </label>
                <button type="button" className="btn btn-sm" disabled={pending} onClick={() => start(async () => void done(await saveGoogleCalendarSettingsAction(g)))}>
                  {t("Save")}
                </button>
                <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => start(async () => void done(await syncCalendarsAction()))}>
                  {pending ? t("Reading …") : t("Sync now")}
                </button>
                <span className="text-xs text-zinc-500">
                  {t("Reads in this account's automation Chrome — signed in?")}{" "}
                  <Link href="/settings/connections#sign-ins" className="text-indigo-600 hover:underline dark:text-indigo-400">
                    {t("Sign-ins")}
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
