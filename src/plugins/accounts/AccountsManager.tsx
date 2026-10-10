"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createAccountAction, deleteAccountAction, startSetupAction, switchAccountAction, updateAccountAction } from "@/app/actions";
import { toast } from "@/components/Toaster";
import { ACCOUNT_DOT, dotOf } from "./AccountSwitcher";

type Row = { id: string; name: string; color: string; createdAt: string; dir: string; current: boolean };

const COLORS = Object.keys(ACCOUNT_DOT);

function ColorPicker({ value, onChange, disabled }: { value: string; onChange: (c: string) => void; disabled?: boolean }) {
  return (
    <span className="flex items-center gap-1" role="radiogroup" aria-label="Farbe">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          disabled={disabled}
          onClick={() => onChange(c)}
          className={`size-5 rounded-full ${dotOf(c)} ring-offset-2 transition dark:ring-offset-zinc-900 ${value === c ? "ring-2 ring-zinc-500" : "opacity-60 hover:opacity-100"}`}
        />
      ))}
    </span>
  );
}

/** The accounts: switch, rename and recolor, remove — and a new one. */
export function AccountsManager({ accounts, busy }: { accounts: Row[]; busy: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", color: "indigo" });
  const [fresh, setFresh] = useState({ name: "", color: "emerald", copyFrom: "", shareChrome: true });
  // The account just made: its setup assistant one click away.
  const [made, setMade] = useState<{ id: string; name: string } | null>(null);

  const done = (r: { ok: boolean; message?: string; error?: string } | null) => {
    toast(r?.ok ? (r.message ?? "Erledigt.") : (r?.error ?? "Ging nicht."), { tone: r?.ok ? "ok" : "error" });
    if (r?.ok) router.refresh();
    return !!r?.ok;
  };

  return (
    <div className="space-y-6">
      {busy && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Gerade läuft {busy} — wechseln geht, sobald es fertig ist.
        </p>
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {accounts.map((a) => (
          <li key={a.id} className={`card space-y-2 p-4 ${a.current ? "ring-2 ring-indigo-500/40" : ""}`}>
            {editing === a.id ? (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  start(async () => {
                    if (done(await updateAccountAction(a.id, draft))) setEditing(null);
                  });
                }}
              >
                <input className="input w-full" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Name" autoFocus />
                <div className="flex items-center justify-between gap-2">
                  <ColorPicker value={draft.color} onChange={(color) => setDraft({ ...draft, color })} disabled={pending} />
                  <span className="flex gap-2">
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>
                      Abbrechen
                    </button>
                    <button type="submit" className="btn btn-sm btn-primary" disabled={pending}>
                      Speichern
                    </button>
                  </span>
                </div>
              </form>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="flex min-w-0 items-center gap-2 font-medium">
                    <span className={`size-2.5 shrink-0 rounded-full ${dotOf(a.color)}`} aria-hidden />
                    <span className="truncate">{a.name}</span>
                    {a.current && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">aktiv</span>}
                  </h2>
                  <span className="flex shrink-0 gap-2">
                    {!a.current && (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={pending || !!busy}
                        title={busy ? `Gerade läuft ${busy}` : `In „${a.name}“ wechseln`}
                        onClick={() =>
                          start(async () => {
                            const r = await switchAccountAction(a.id);
                            if (done(r)) router.push(r.href ?? "/");
                          })
                        }
                      >
                        Wechseln
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={pending}
                      onClick={() => {
                        setDraft({ name: a.name, color: a.color });
                        setEditing(a.id);
                      }}
                    >
                      Bearbeiten
                    </button>
                    {!a.current && a.id !== "default" && (
                      <button
                        type="button"
                        className="btn btn-sm text-red-600 dark:text-red-400"
                        disabled={pending}
                        onClick={() => {
                          if (!confirm(`Konto „${a.name}“ entfernen? Seine Daten werden beiseitegelegt (data\\accounts\\.deleted), nicht gelöscht.`)) return;
                          start(async () => void done(await deleteAccountAction(a.id)));
                        }}
                      >
                        Entfernen
                      </button>
                    )}
                  </span>
                </div>
                <p className="truncate text-xs text-zinc-500" title={a.dir}>
                  {a.dir}
                </p>
              </>
            )}
          </li>
        ))}
      </ul>

      {made && (
        <section className="card max-w-xl space-y-2 border-indigo-200 bg-indigo-50 p-4 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
          <p className="font-medium">„{made.name}“ ist angelegt.</p>
          <p className="text-zinc-600 dark:text-zinc-300">Der Einrichtungs-Assistent führt durch Plugins, Einstellungen, Anmeldungen — und holt am Ende alle Daten und wertet sie zum ersten Mal aus.</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await startSetupAction(made.id);
                  if (r && !r.ok) done(r);
                })
              }
            >
              Einrichtung starten
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setMade(null)}>
              Später
            </button>
          </div>
        </section>
      )}

      <form
        className="card max-w-xl space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await createAccountAction({ name: fresh.name, color: fresh.color, copyFrom: fresh.copyFrom || undefined, shareChrome: !!fresh.copyFrom && fresh.shareChrome });
            if (done(r) && r?.id) {
              setMade({ id: r.id, name: fresh.name.trim() });
              setFresh({ name: "", color: "emerald", copyFrom: "", shareChrome: true });
            }
          });
        }}
      >
        <h2 className="font-medium">Neues Konto</h2>
        <label className="block space-y-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-300">Name</span>
          <input className="input w-full" value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} placeholder="z. B. Privat" required />
        </label>
        <div className="space-y-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-300">Farbe</span>
          <ColorPicker value={fresh.color} onChange={(color) => setFresh({ ...fresh, color })} disabled={pending} />
        </div>
        <label className="block space-y-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-300">Einstellungen übernehmen von</span>
          <select className="input w-full" value={fresh.copyFrom} onChange={(e) => setFresh({ ...fresh, copyFrom: e.target.value })}>
            <option value="">— keinem (leer, Standard-Plugins) —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <span className="block text-xs text-zinc-500">Einstellungen, KI-Backends, LLM-Anweisungen, installierte Plugins, Repos, Boards, Bericht-Regeln, Arbeitszeiten, Kalender-Verbindung, Menü, Sync-Intervalle — keine Buchungen, Todos oder Mails.</span>
        </label>
        {fresh.copyFrom && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={fresh.shareChrome} onChange={(e) => setFresh({ ...fresh, shareChrome: e.target.checked })} />
            <span>
              Anmeldungen mitbenutzen
              <span className="block text-xs text-zinc-500">
                Den Automations-Chrome von „{accounts.find((a) => a.id === fresh.copyFrom)?.name}“ — dort ist schon alles angemeldet. Ohne: ein eigener Chrome, in dem du dich neu anmeldest.
              </span>
            </span>
          </label>
        )}
        <button type="submit" className="btn btn-primary" disabled={pending || !fresh.name.trim()}>
          Anlegen
        </button>
      </form>
    </div>
  );
}
