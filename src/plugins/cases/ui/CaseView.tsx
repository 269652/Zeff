"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { TodoSources } from "@/components/boards/TodoSources";
import { GiroCode } from "@/components/GiroCode";
import { caseBundleAction, caseOpAction } from "../block-actions";
import type { CaseBundle, CaseOperation } from "../blocks";

/**
 * A case's page — the custom view of the cases database's rows: what it is about and where it stands, the money and where to
 * pay, its todos, its mails and letters in time order, your note. One bundle per row, read again after each operation.
 */

function Card({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="ws-module space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <div role="heading" aria-level={3} className="flex items-baseline justify-between gap-2 text-xs font-semibold text-zinc-500 uppercase">
        <span>{title}</span>
        {extra}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-zinc-400">{children}</p>;
const euro = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString(undefined, { style: "currency", currency: "EUR" }));

export default function CaseView({ rowId }: { rowId: number }) {
  const t = useT();
  const [d, setD] = useState<CaseBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await caseBundleAction(rowId);
    if (r.ok) setD(r.case);
    else setError(r.error);
  }, [rowId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read when shown (the state is set once the answer is there)
  useEffect(() => void load(), [load]);
  // While it is being summed up: read again every few seconds until the summary is there.
  useEffect(() => {
    if (!d?.compiling || d.compiled) return;
    const id = setInterval(() => void load(), 8000);
    return () => clearInterval(id);
  }, [d?.compiling, d?.compiled, load]);
  const run = async (op: CaseOperation) => {
    setBusy(true);
    const r = await caseOpAction(rowId, op);
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    if (r.message) toast(r.message);
    await load();
  };
  if (!d) return <Empty>{error ?? "…"}</Empty>;
  const s = d.compiled;
  return (
    <div className="@container space-y-5" data-case-view>
      <header className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-zinc-200 px-2 py-0.5 font-mono text-xs dark:border-zinc-700">{d.label}</span>
        {d.person && (
          <Link href={d.person.href} className="ws-chip" data-kind="person">
            {d.person.name}
          </Link>
        )}
        {s?.party && <span className="text-sm text-zinc-500">{s.party}</span>}
        <span className="ml-auto flex items-center gap-2">
          <select className="input w-auto" value={d.status} onChange={(e) => void run({ op: "status", status: e.target.value })} aria-label={t("Status")}>
            <option value="open">{t("Open")}</option>
            <option value="closed">{t("Closed")}</option>
            <option value="ignored">{t("Not a case")}</option>
          </select>
          {d.canCompile && (
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void run({ op: "compile" })}>
              {busy ? "…" : s ? t("Sum up again") : t("Sum up")}
            </button>
          )}
        </span>
      </header>

      <div className="grid gap-x-8 gap-y-5 @2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card title={t("Where it stands")}>
            {s?.summary ? <p className="text-sm">{s.summary}</p> : <Empty>{d.compiling ? t("Being summed up from its mails, letters and todos …") : d.canCompile ? t("Not summed up yet — Sum up reads its mails, letters and todos.") : t("With the LLM plugin the AI sums the case up.")}</Empty>}
            {s && (
              <dl className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
                {[
                  [t("Total"), euro(s.total)],
                  [t("Open"), euro(d.openNow ?? s.open)],
                  [t("Instalment"), euro(s.installment)],
                  [t("Next"), s.nextDue ? `${new Date(s.nextDue).toLocaleDateString()}${s.nextWhat ? ` · ${s.nextWhat}` : ""}` : "—"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-md border border-zinc-200 px-2.5 py-1.5 dark:border-zinc-800">
                    <dt className="text-xs text-zinc-500">{k}</dt>
                    <dd className="text-sm font-medium tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>

          <Card title={t("Todos")}>
            {d.todos.length ? (
              <ul className="space-y-1 text-sm">
                {d.todos.map((x) => (
                  <li key={x.id} className="flex items-baseline gap-2">
                    <Link href={`/t/${x.id}`} className="font-mono text-xs text-zinc-400 hover:underline">
                      {x.ref}
                    </Link>
                    <span className={`min-w-0 flex-1 ${x.done ? "text-zinc-400 line-through" : ""}`}>{x.text}</span>
                    {x.due && !x.done && <span className="shrink-0 text-xs text-zinc-500">{x.due}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>{t("No todo names this case.")}</Empty>
            )}
          </Card>

          <Card title={t("Mails and letters")} extra={<span className="font-normal normal-case">{t("{m} mails · {d} letters", { m: d.counts.mail, d: d.counts.doc })}</span>}>
            {d.sources.length ? <TodoSources list={d.sources} startOpen /> : <Empty>{t("No mail or letter found for it yet.")}</Empty>}
          </Card>
        </div>

        <aside className="space-y-5">
          <Card title={t("Payment")}>
            {d.payment ? <Pay name={d.payment.name} iban={d.payment.iban} bic={d.payment.bic} purpose={d.payment.purpose} suggested={d.payment.amount} /> : <Empty>{d.person ? t("No account known for {name} yet — add the IBAN to their details.", { name: d.person.name }) : t("No account known for it yet — choose the person it is with.")}</Empty>}
          </Card>

          {d.paid.length > 0 && (
            <Card title={t("Paid (bank)")}>
              <ul className="space-y-1 text-sm">
                {[...d.paid].reverse().map((p, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-2">
                    <span className="text-zinc-500">{new Date(p.date).toLocaleDateString()}</span>
                    <span className="tabular-nums">{euro(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title={t("Person")}>
            <select className="input" value={d.person?.id ?? ""} onChange={(e) => void run({ op: "person", personId: e.target.value ? Number(e.target.value) : null })} aria-label={t("Person")}>
              <option value="">{t("— nobody —")}</option>
              {d.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Card>

          <NoteCard note={d.note} onSave={(note) => run({ op: "note", note })} />
        </aside>
      </div>
    </div>
  );
}

/** The payment as a GiroCode: the instalment (else what is open) as the amount to start with — yours to change. */
function Pay({ name, iban, bic, purpose, suggested }: { name: string; iban: string; bic: string; purpose: string; suggested: number | null }) {
  const t = useT();
  const [amount, setAmount] = useState(suggested != null ? suggested.toFixed(2).replace(".", ",") : "");
  const value = Number(amount.replace(/\./g, "").replace(",", "."));
  return (
    <div className="space-y-2">
      <label className="block text-sm">
        <span className="label">{t("Amount")}</span>
        <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
      </label>
      <GiroCode name={name} iban={iban} bic={bic || null} amount={amount.trim() && value > 0 ? value : null} purpose={purpose} />
    </div>
  );
}

function NoteCard({ note, onSave }: { note: string; onSave: (note: string) => Promise<void> }) {
  const t = useT();
  const [v, setV] = useState(note);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the note as saved elsewhere follows
  useEffect(() => setV(note), [note]);
  return (
    <Card title={t("Notes")}>
      <textarea className="input min-h-24" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== note && void onSave(v)} placeholder={t("What you want to remember about this case")} />
    </Card>
  );
}
