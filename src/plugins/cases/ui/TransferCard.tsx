"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { GiroCode } from "@/components/GiroCode";
import { CopyButton } from "@/components/CopyButton";
import { ibanValid } from "@/lib/girocode";
import { saveTransferAction } from "@/plugins/todos/server-actions";

/**
 * A todo's transfer, in its card: the fields to change (recipient, IBAN, BIC, amount, purpose) and the GiroCode beside
 * them, following what you type — scan it with your banking app. A field is saved when you leave it (a wrong IBAN is
 * said, not saved).
 */

type Fields = { name: string; iban: string; bic: string; amount: string; purpose: string };

/** "11.52" → "11,52" for typing; back again for the code. */
const shown = (amount: string) => (amount ? Number(amount).toFixed(2).replace(".", ",") : "");
const euros = (typed: string) => {
  const n = Number(typed.replace(/[€\s]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function TransferCard({ op, todoId, index }: { op: Fields; todoId?: number; index: number }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState<Fields>({ ...op, amount: shown(op.amount) });
  const [pending, start] = useTransition();
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- the fields follow the transfer as saved
  useEffect(() => setF({ ...op, amount: shown(op.amount) }), [op.name, op.iban, op.bic, op.amount, op.purpose]);
  const ibanOk = ibanValid(f.iban);
  const amount = euros(f.amount);
  const changed = f.name !== op.name || f.iban !== op.iban || f.bic !== op.bic || (amount?.toFixed(2) ?? "") !== op.amount || f.purpose !== op.purpose;
  const save = () => {
    if (!changed || todoId === undefined || !ibanOk || !f.name.trim()) return;
    start(async () => {
      const r = await saveTransferAction(todoId, index, { ...f, amount: amount != null ? amount.toFixed(2) : "" });
      if (!r?.ok) toast(r?.error ?? t("Didn't work."), { tone: "error" });
      router.refresh();
    });
  };
  const field = (key: keyof Fields, label: string, opts: { mono?: boolean; wide?: boolean; inputMode?: "decimal"; bad?: string | null } = {}) => (
    <label className={`block text-xs ${opts.wide ? "col-span-2" : ""}`}>
      <span className="text-zinc-500">{label}</span>
      <span className="flex items-center gap-1">
        <input
          className={`input h-8 w-full text-sm ${opts.mono ? "font-mono text-[13px]" : ""} ${opts.bad ? "!border-red-400" : ""}`}
          value={f[key]}
          inputMode={opts.inputMode}
          onChange={(e) => setF({ ...f, [key]: e.target.value })}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          aria-invalid={!!opts.bad}
        />
        <CopyButton text={key === "iban" ? f.iban.replace(/\s+/g, "") : f[key]} className="shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" title={t("Copy")}>
          ⧉
        </CopyButton>
      </span>
      {opts.bad && <span className="text-red-600 dark:text-red-400">{opts.bad}</span>}
    </label>
  );
  return (
    <span className="mt-1 flex flex-wrap items-start gap-4" data-transfer-card>
      <span className="grid min-w-64 flex-1 grid-cols-2 gap-x-3 gap-y-1.5">
        {field("name", t("Recipient"), { wide: true, bad: f.name.trim() ? null : t("Who gets it?") })}
        {field("iban", "IBAN", { mono: true, wide: true, bad: ibanOk ? null : t("Not a valid IBAN.") })}
        {field("bic", "BIC", { mono: true })}
        {field("amount", t("Amount"), { inputMode: "decimal", bad: f.amount.trim() && amount == null ? t("Not an amount — e.g. 11,52") : null })}
        {field("purpose", t("Purpose"), { wide: true })}
        {pending && <span className="col-span-2 text-xs text-zinc-400">…</span>}
      </span>
      <span className="shrink-0">{ibanOk && f.name.trim() ? <GiroCode name={f.name} iban={f.iban} bic={f.bic || null} amount={amount} purpose={f.purpose} codeOnly /> : <span className="block w-40 text-xs text-zinc-400">{t("The GiroCode shows once recipient and IBAN are right.")}</span>}</span>
    </span>
  );
}
