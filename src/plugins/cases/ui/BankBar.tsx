"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { bankStatusAction, importStatementAction, saveBankSettingsAction, startBankAuthAction, syncBankAction, type BankStatus } from "../block-actions";

/**
 * The bank above the cases: a statement read from a file (CSV — Revolut's export or your bank's), the overview of the
 * debts, and the bank connection (Enable Banking: your application's id and key, then signing in at your bank once).
 */
export function BankBar({ onChanged }: { onChanged: () => void }) {
  const t = useT();
  const file = useRef<HTMLInputElement>(null);
  const [bank, setBank] = useState<BankStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ appId: "", privateKey: "", aspsp: "Revolut", country: "DE" });
  const status = () => void bankStatusAction().then((r) => r.ok && (setBank(r.bank), setF((x) => ({ ...x, appId: r.bank.appId || x.appId, aspsp: r.bank.aspsp, country: r.bank.country }))));
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read when shown (the state is set once the answer is there)
  useEffect(status, []);
  const say = (r: { ok: boolean; message?: string; error?: string }) => {
    toast(r.ok ? (r.message ?? t("Done.")) : (r.error ?? t("Didn't work.")), { tone: r.ok ? "ok" : "error" });
    if (r.ok) onChanged();
    status();
  };
  const read = async (list: FileList | null) => {
    const one = list?.[0];
    if (!one) return;
    setBusy(true);
    const r = await importStatementAction(await one.text(), /revolut/i.test(one.name) ? "Revolut" : one.name.replace(/\.csv$/i, ""));
    setBusy(false);
    say(r.ok ? { ok: true, message: r.message } : r);
    if (file.current) file.current.value = "";
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void read(e.target.files)} />
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => file.current?.click()}>
          {busy ? "…" : t("Import statement (CSV)")}
        </button>
        <Link href="/vorgaenge/uebersicht" className="btn btn-sm">
          {t("Debt overview")}
        </Link>
        <button type="button" className={`btn btn-sm ${open ? "btn-primary" : ""}`} onClick={() => setOpen(!open)}>
          🏦 {bank?.connected ? t("Bank connected") : t("Connect bank")}
        </button>
        {bank?.connected && (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => (setBusy(true), void syncBankAction().then((r) => (setBusy(false), say(r))))}>
            {t("Fetch bookings")}
          </button>
        )}
        <span className="text-xs text-zinc-500">
          {bank ? t("{n} bookings", { n: bank.transactions }) : ""}
          {bank?.lastSync ? ` · ${t("fetched {when}", { when: new Date(bank.lastSync).toLocaleString() })}` : ""}
          {bank?.validUntil ? ` · ${t("access until {date}", { date: new Date(bank.validUntil).toLocaleDateString() })}` : ""}
        </span>
      </div>
      {open && (
        <div className="space-y-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <p className="text-zinc-500">{t("Your bookings, fetched by themselves through Enable Banking — free for your own accounts. Once: make an application at enablebanking.com (restricted mode), register this redirect address, link your bank there, then enter the application's id and private key here and sign in at your bank.")}</p>
          <p className="font-mono text-xs break-all text-zinc-600 dark:text-zinc-300">{typeof window === "undefined" ? "" : `${window.location.origin}/api/bank/callback`}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="label">{t("Application id")}</span>
              <input className="input" value={f.appId} onChange={(e) => setF({ ...f, appId: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">{t("Bank")}</span>
              <input className="input" value={f.aspsp} onChange={(e) => setF({ ...f, aspsp: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">{t("Country")}</span>
              <input className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} />
            </label>
          </div>
          <label className="block">
            <span className="label">{bank?.configured ? t("Private key (PEM) — empty: the saved one stays") : t("Private key (PEM)")}</span>
            <textarea className="input min-h-20 font-mono text-xs" value={f.privateKey} onChange={(e) => setF({ ...f, privateKey: e.target.value })} placeholder="-----BEGIN PRIVATE KEY-----" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void saveBankSettingsAction(f).then((r) => say(r.ok ? { ok: true, message: t("Saved.") } : r))}>
              {t("Save")}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy || !bank?.configured}
              onClick={() =>
                void startBankAuthAction().then((r) => {
                  if (r.ok) window.location.href = r.url;
                  else say(r);
                })
              }
            >
              {bank?.connected ? t("Sign in at the bank again") : t("Sign in at the bank")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
