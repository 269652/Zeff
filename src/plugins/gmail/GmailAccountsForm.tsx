"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { openGmailAddAccountAction, saveGmailAccountsAction } from "@/app/actions";
import { toast } from "@/components/Toaster";
import type { GmailAccount, SignedInGmail } from "./accounts";

type Row = { account: string; label: string; read: boolean; name?: string; number?: number; signedIn: boolean };

/**
 * The Gmail accounts: those signed in in the automation Chrome (Google's list) — each read or not,
 * with a name (its folder) — and those set but no longer signed in. Another one added through
 * Google's own sign-in there.
 */
export function GmailAccountsForm({ signedIn, configured }: { signedIn: SignedInGmail[] | null; configured: GmailAccount[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // A set account by its address, or by Gmail's number (the default "0": the first signed in).
  const setFor = (g: SignedInGmail) => configured.find((c) => c.account === g.email || c.account === String(g.number));
  const [rows, setRows] = useState<Row[]>(() => [
    ...(signedIn ?? []).map((g) => ({ account: g.email, label: setFor(g)?.label ?? "", read: !!setFor(g), name: g.name, number: g.number, signedIn: true })),
    ...configured
      .filter((c) => !(signedIn ?? []).some((g) => c.account === g.email || c.account === String(g.number)))
      .map((c) => ({ account: c.account, label: c.label, read: true, signedIn: false })),
  ]);
  const set = (i: number, patch: Partial<Row>) => setRows((l) => l.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const act = (fn: () => Promise<{ ok: boolean; message?: string; error?: string } | null>) =>
    start(async () => {
      const r = await fn();
      toast(r?.ok ? (r.message ?? "Erledigt.") : (r?.error ?? "Ging nicht."), { tone: r?.ok ? "ok" : "error" });
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {signedIn === null && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Der Automations-Chrome läuft nicht — welche Konten dort angemeldet sind, zeigt sich, sobald er läuft („Konto hinzufügen“ startet ihn).
        </p>
      )}
      {signedIn?.length === 0 && <p className="text-sm text-zinc-500">Im Automations-Chrome ist kein Google-Konto angemeldet — „Konto hinzufügen“.</p>}
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {rows.map((r, i) => (
          <li key={r.account} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
            <label className="flex min-w-0 flex-1 basis-64 items-center gap-3">
              <input type="checkbox" className="size-4" checked={r.read} onChange={(e) => set(i, { read: e.target.checked })} aria-label={`${r.account} lesen`} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.account}</span>
                <span className="block text-xs text-zinc-500">
                  {r.signedIn ? `${r.name ? `${r.name} · ` : ""}angemeldet (Konto ${r.number})` : <span className="text-amber-700 dark:text-amber-400">nicht angemeldet im Automations-Chrome</span>}
                </span>
              </span>
            </label>
            <input className="input w-44" value={r.label} placeholder="Name (Ordner)" aria-label={`${r.account}: Name`} disabled={!r.read} onChange={(e) => set(i, { label: e.target.value })} />
          </li>
        ))}
        {!rows.length && <li className="px-3 py-2.5 text-sm text-zinc-500">Noch kein Konto.</li>}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => act(() => saveGmailAccountsAction(rows.filter((r) => r.read).map((r) => ({ account: r.account, label: r.label }))))}>
          {pending ? "…" : "Speichern"}
        </button>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(openGmailAddAccountAction)} title="Googles Anmeldung im Automations-Chrome nach vorne — dort meldest du dich mit dem weiteren Konto an">
          + Konto hinzufügen
        </button>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => router.refresh()}>
          Neu laden
        </button>
      </div>
    </div>
  );
}
