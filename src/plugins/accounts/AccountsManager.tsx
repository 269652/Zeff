"use client";

import { confirmAction } from "@/components/confirm";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createAccountAction, deleteAccountAction, switchAccountAction, updateAccountAction } from "@/plugins/accounts/server-actions";
import { startSetupAction } from "@/app/actions";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { ACCOUNT_DOT, accountUrl, dotOf } from "./AccountSwitcher";

type Row = { id: string; name: string; color: string; host: string; createdAt: string; dir: string; current: boolean; workerSetup: boolean };

const COLORS = Object.keys(ACCOUNT_DOT);

function ColorPicker({ value, onChange, disabled }: { value: string; onChange: (c: string) => void; disabled?: boolean }) {
  const t = useT();
  return (
    <span className="flex items-center gap-1" role="radiogroup" aria-label={t("Colour")}>
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
export function AccountsManager({ accounts }: { accounts: Row[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", color: "indigo", host: "", workerSetup: false });
  const [fresh, setFresh] = useState({ name: "", color: "emerald", copyFrom: "", shareChrome: true });
  // The account just made: its setup assistant one click away.
  const [made, setMade] = useState<{ id: string; name: string } | null>(null);

  const done = (r: { ok: boolean; message?: string; error?: string } | null) => {
    toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("That didn't work.")), { tone: r?.ok ? "ok" : "error" });
    if (r?.ok) router.refresh();
    return !!r?.ok;
  };

  return (
    <div className="space-y-6">
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
                <input className="input w-full" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label={t("Name")} autoFocus />
                <label className="block text-xs text-zinc-500">
                  {t("Its own address (host name) — accounts with one run side by side, each in its own tab: e.g. privat.localhost, business.localhost. Empty: the address of whichever account is active.")}
                  <input className="input mt-1 w-full font-mono text-sm" value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} placeholder="privat.localhost" aria-label={t("Address (host name)")} />
                </label>
                <label className="flex items-start gap-2 text-xs text-zinc-500">
                  <input type="checkbox" className="mt-0.5" checked={draft.workerSetup} onChange={(e) => setDraft({ ...draft, workerSetup: e.target.checked })} />
                  <span>{t("Its workers may use this computer's setup: Zeff's .env (its secrets) and your own MCP servers. Off: they get only this account's Zeff — nothing of another account's.")}</span>
                </label>
                <div className="flex items-center justify-between gap-2">
                  <ColorPicker value={draft.color} onChange={(color) => setDraft({ ...draft, color })} disabled={pending} />
                  <span className="flex gap-2">
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>
                      {t("Cancel")}
                    </button>
                    <button type="submit" className="btn btn-sm btn-primary" disabled={pending}>
                      {t("Save")}
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
                    {a.current && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">{t("active")}</span>}
                  </h2>
                  {a.host && (
                    <button type="button" onClick={() => window.location.assign(accountUrl(a.host, "/"))} className="font-mono text-xs text-indigo-600 hover:underline dark:text-indigo-400" title={t("Opens this account at its own address")}>
                      {a.host}
                    </button>
                  )}
                  <span className="flex shrink-0 gap-2">
                    {!a.current && (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={pending}
                        title={t("Switch to “{name}”", { name: a.name })}
                        onClick={() =>
                          // At its own address: opened there (side by side with this one), not switched to. The one without an
                          // address while the others have theirs is every other address (localhost).
                          a.host
                            ? window.location.assign(accountUrl(a.host, "/"))
                            : accounts.filter((x) => !x.host).length === 1 && accounts.some((x) => x.host)
                              ? window.location.assign(accountUrl("localhost", "/"))
                              : start(async () => {
                                  const r = await switchAccountAction(a.id);
                                  if (done(r)) router.push(r.href ?? "/");
                                })
                        }
                      >
                        {t("Switch")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={pending}
                      onClick={() => {
                        setDraft({ name: a.name, color: a.color, host: a.host, workerSetup: a.workerSetup });
                        setEditing(a.id);
                      }}
                    >
                      {t("Edit")}
                    </button>
                    {!a.current && a.id !== "default" && (
                      <button
                        type="button"
                        className="btn btn-sm text-red-600 dark:text-red-400"
                        disabled={pending}
                        onClick={() => {
                          if (!confirmAction(t("Remove the account “{name}”? Its data is set aside ({dir}), not deleted.", { name: a.name, dir: "data\\accounts\\.deleted" }))) return;
                          start(async () => void done(await deleteAccountAction(a.id)));
                        }}
                      >
                        {t("Remove")}
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
          <p className="font-medium">{t("“{name}” has been created.", { name: made.name })}</p>
          <p className="text-zinc-600 dark:text-zinc-300">{t("The setup assistant walks you through plugins, settings, sign-ins — and at the end fetches all the data and analyses it for the first time.")}</p>
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
              {t("Start setup")}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setMade(null)}>
              {t("Later")}
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
        <h2 className="font-medium">{t("New account")}</h2>
        <label className="block space-y-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-300">{t("Name")}</span>
          <input className="input w-full" value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} placeholder={t("e.g. Private")} required />
        </label>
        <div className="space-y-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-300">{t("Colour")}</span>
          <ColorPicker value={fresh.color} onChange={(color) => setFresh({ ...fresh, color })} disabled={pending} />
        </div>
        <label className="block space-y-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-300">{t("Take over settings from")}</span>
          <select className="input w-full" value={fresh.copyFrom} onChange={(e) => setFresh({ ...fresh, copyFrom: e.target.value })}>
            <option value="">{t("— none (empty, default plugins) —")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <span className="block text-xs text-zinc-500">
            {t("Settings, AI backends, LLM instructions, installed plugins, repos, boards, report rules, working hours, calendar connection, menu, sync intervals — no entries, todos or mails.")}
          </span>
        </label>
        {fresh.copyFrom && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={fresh.shareChrome} onChange={(e) => setFresh({ ...fresh, shareChrome: e.target.checked })} />
            <span>
              {t("Share the sign-ins")}
              <span className="block text-xs text-zinc-500">
                {t("The automation Chrome of “{name}” — everything is already signed in there. Without: a Chrome of its own, where you sign in again.", {
                  name: accounts.find((a) => a.id === fresh.copyFrom)?.name,
                })}
              </span>
            </span>
          </label>
        )}
        <button type="submit" className="btn btn-primary" disabled={pending || !fresh.name.trim()}>
          {t("Create")}
        </button>
      </form>
    </div>
  );
}
