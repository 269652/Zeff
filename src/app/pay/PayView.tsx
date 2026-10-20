"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { GiroCode } from "@/components/GiroCode";

/** The GiroCode of a transfer, the amount and purpose yours to change before you scan it. */
export function PayView(p: { name: string; iban: string; bic: string; amount: string; purpose: string }) {
  const t = useT();
  const [amount, setAmount] = useState(p.amount ? Number(p.amount).toFixed(2).replace(".", ",") : "");
  const [purpose, setPurpose] = useState(p.purpose);
  const value = Number(amount.replace(/\./g, "").replace(",", "."));
  if (!p.name || !p.iban) return <p className="text-sm text-zinc-500">{t("No account given.")}</p>;
  return (
    <div className="space-y-3">
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
      <GiroCode name={p.name} iban={p.iban} bic={p.bic || null} amount={amount.trim() && value > 0 ? value : null} purpose={purpose} />
    </div>
  );
}
