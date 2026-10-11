"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { openGmailAddAccountAction, saveGmailAccountsAction } from "@/plugins/gmail/server-actions";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import type { GmailAccount, SignedInGmail } from "./accounts";

type Row = { account: string; label: string; read: boolean; name?: string; number?: number; signedIn: boolean };

/**
 * The Gmail accounts: those signed in in the automation Chrome (Google's list) — each read or not,
 * with a name (its folder) — and those set but no longer signed in. Another one added through
 * Google's own sign-in there.
 */
export function GmailAccountsForm({ signedIn, configured }: { signedIn: SignedInGmail[] | null; configured: GmailAccount[] }) {
  const t = useT();
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
      toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("That didn't work.")), { tone: r?.ok ? "ok" : "error" });
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {signedIn === null && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {t("The automation Chrome isn't running — which accounts are signed in there shows as soon as it runs (“Add account” starts it).")}
        </p>
      )}
      {signedIn?.length === 0 && <p className="text-sm text-zinc-500">{t("No Google account is signed in in the automation Chrome — “Add account”.")}</p>}
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {rows.map((r, i) => (
          <li key={r.account} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
            <label className="flex min-w-0 flex-1 basis-64 items-center gap-3">
              <input type="checkbox" className="size-4" checked={r.read} onChange={(e) => set(i, { read: e.target.checked })} aria-label={t("Read {account}", { account: r.account })} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.account}</span>
                <span className="block text-xs text-zinc-500">
                  {r.signedIn ? (
                    `${r.name ? `${r.name} · ` : ""}${t("signed in (account {n})", { n: r.number })}`
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400">{t("not signed in in the automation Chrome")}</span>
                  )}
                </span>
              </span>
            </label>
            <input className="input w-44" value={r.label} placeholder={t("Name (folder)")} aria-label={t("{account}: name", { account: r.account })} disabled={!r.read} onChange={(e) => set(i, { label: e.target.value })} />
          </li>
        ))}
        {!rows.length && <li className="px-3 py-2.5 text-sm text-zinc-500">{t("No account yet.")}</li>}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => act(() => saveGmailAccountsAction(rows.filter((r) => r.read).map((r) => ({ account: r.account, label: r.label }))))}>
          {pending ? "…" : t("Save")}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={pending}
          onClick={() => act(openGmailAddAccountAction)}
          title={t("Brings Google's sign-in to the front in the automation Chrome — sign in there with the other account")}
        >
          {t("+ Add account")}
        </button>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => router.refresh()}>
          {t("Reload")}
        </button>
      </div>
    </div>
  );
}
