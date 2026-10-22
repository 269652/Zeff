"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { ContactField, type ContactOption } from "@/plugins/cases/ui/ContactField";
import type { DebtSuggestion, Direction } from "../own";
import { createDebtAction, debtFromClaimAction } from "../server-actions";

/**
 * A debt of your own written down — to whom (a contact, or a new one), what for, how much, by when — and your promises with an
 * amount offered as debts ("Johanna: 200 € zurücküberweisen" → a debt to Johanna).
 */
export function AddDebt({ dir = "owe", contacts, suggestions, onDone, startOpen = false, hideButton = false }: { dir?: Direction; contacts: ContactOption[]; suggestions: DebtSuggestion[]; onDone: () => void; startOpen?: boolean; /** Only the promises offered (the button is elsewhere). */ hideButton?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(startOpen);
  const [busy, setBusy] = useState(false);
  const [creditor, setCreditor] = useState<{ id: number } | { name: string; kind: "person" | "organization" } | null>(null);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [installment, setInstallment] = useState("");
  const [due, setDue] = useState("");
  const num = (v: string) => {
    const n = Number(v.replace(/\./g, "").replace(",", "."));
    return v.trim() && Number.isFinite(n) && n > 0 ? n : null;
  };
  const euro = (v: number) => v.toLocaleString(undefined, { style: "currency", currency: "EUR" });
  const save = async () => {
    if (!title.trim() || !creditor) return;
    setBusy(true);
    const r = await createDebtAction({ dir, title, ...("id" in creditor ? { creditorId: creditor.id } : { creditorName: creditor.name, creditorKind: creditor.kind }), amount: num(amount), installment: num(installment), due: due || null });
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    toast(t("Debt written down ✓"));
    setOpen(false);
    setTitle("");
    setAmount("");
    setInstallment("");
    setDue("");
    setCreditor(null);
    onDone();
  };
  return (
    <div className="space-y-2">
      {suggestions.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="mb-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">{t("Your promises with an amount — write them down as debts?")}</p>
          <ul className="space-y-1.5">
            {suggestions.map((s) => (
              <li key={s.claimId} className="flex items-start gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{s.name}</span> · {euro(s.amount)}
                  {s.due && <span className="text-zinc-500"> · {new Date(s.due).toLocaleDateString()}</span>}
                  <span className="block truncate text-xs text-zinc-500" title={s.text}>
                    {s.text}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-sm shrink-0"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const r = await debtFromClaimAction(s.claimId);
                    setBusy(false);
                    if (!r.ok) toast(r.error, { tone: "error" });
                    else onDone();
                  }}
                >
                  + {t("As a debt")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {open ? (
        <form
          className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-zinc-500">{t("Creditor")}</span>
              {creditor && "name" in creditor ? (
                <span className="flex items-center gap-2 py-1 text-sm">
                  <span className="font-medium">{creditor.name}</span>
                  <span className="text-xs text-zinc-500">({creditor.kind === "organization" ? t("Organisation") : t("Person")}, {t("new")})</span>
                  <button type="button" className="text-xs text-zinc-500 hover:underline" onClick={() => setCreditor(null)}>
                    {t("change")}
                  </button>
                </span>
              ) : (
                <ContactField contacts={contacts} value={creditor && "id" in creditor ? creditor.id : null} label={t("Creditor")} placeholder={t("Person, bank, collection agency …")} onPick={(id) => setCreditor(id ? { id } : null)} onNew={(name, kind) => setCreditor({ name, kind })} />
              )}
            </label>
            <label className="block">
              <span className="text-xs text-zinc-500">{t("What for")}</span>
              <input className="input py-1 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. lent for the repair")} required />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-xs text-zinc-500">{t("Amount")}</span>
              <input className="input py-1 text-sm tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
            </label>
            <label className="block">
              <span className="text-xs text-zinc-500">{t("Instalment")}</span>
              <input className="input py-1 text-sm tabular-nums" inputMode="decimal" value={installment} onChange={(e) => setInstallment(e.target.value)} placeholder={t("optional")} />
            </label>
            <label className="block">
              <span className="text-xs text-zinc-500">{t("Due")}</span>
              <input type="date" className="input py-1 text-sm" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" disabled={busy || !title.trim() || !creditor}>
              {busy ? "…" : t("Write down")}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </button>
          </div>
        </form>
      ) : hideButton ? null : (
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          + {t("Debt")}
        </button>
      )}
    </div>
  );
}
