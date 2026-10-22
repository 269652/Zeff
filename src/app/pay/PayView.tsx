"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { GiroCode } from "@/components/GiroCode";
import { ibanValid } from "@/lib/girocode";

/** The GiroCode of a transfer, the amount and purpose yours to change before you scan it — the IBAN asked for when it isn't known. */
export function PayView(p: { name: string; iban: string; bic: string; amount: string; purpose: string }) {
  const t = useT();
  const [amount, setAmount] = useState(p.amount ? Number(p.amount).toFixed(2).replace(".", ",") : "");
  const [purpose, setPurpose] = useState(p.purpose);
  const [iban, setIban] = useState(p.iban);
  const value = Number(amount.replace(/\./g, "").replace(",", "."));
  if (!p.name) return <p className="text-sm text-zinc-500">{t("No account given.")}</p>;
  const ok = ibanValid(iban);
  return (
    <div className="space-y-3">
      {!p.iban && (
        <label className="block text-sm">
          <span className="label">{t("IBAN of {name}", { name: p.name })}</span>
          <input className={`input font-mono ${iban.trim() && !ok ? "!border-red-400" : ""}`} value={iban} onChange={(e) => setIban(e.target.value)} placeholder="DE00 0000 0000 0000 0000 00" autoFocus />
          {iban.trim() && !ok && <span className="text-xs text-red-600 dark:text-red-400">{t("Not a valid IBAN.")}</span>}
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          <span className="label">{t("Amount")}</span>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </label>
        <label className="block text-sm">
          <span className="label">{t("Purpose")}</span>
          <input className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </label>
      </div>
      {ok ? <GiroCode name={p.name} iban={iban} bic={p.bic || null} amount={amount.trim() && value > 0 ? value : null} purpose={purpose} /> : <p className="text-sm text-zinc-500">{t("The GiroCode shows once recipient and IBAN are right.")}</p>}
    </div>
  );
}
