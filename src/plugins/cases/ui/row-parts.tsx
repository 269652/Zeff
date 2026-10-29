"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { TodoSources } from "@/components/boards/TodoSources";
import { GiroCode } from "@/components/GiroCode";
import type { AppViewProps, PartProps, ViewAppModule } from "@/plugins/workspace/ui/app-view";
import { caseBundleAction, caseOpAction } from "../block-actions";
import type { CaseBundle, CaseOperation } from "../blocks";
import type { PartyRole } from "../parties";
import { caseAppData } from "../view-data";
import { ContactField } from "./ContactField";
import { TimelineList } from "@/plugins/timeline/ui/TimelineList";
import { KnowPanel } from "@/plugins/know/ui/KnowPanel";

/**
 * A case's own page, client side: what its template reads as app.* (the case's bundle, read when the page opens and after each
 * operation), its Sum up, and the parts it is built of where the language's tags aren't enough — the status, the sources, the
 * GiroCode, the contact pickers, the note.
 */

type Run = (op: CaseOperation) => Promise<void>;

/** The bundle of the page's row worked out for the template (view-data.ts) — with it, for the parts: the bundle and run. */
function useCaseData(props: AppViewProps) {
  const t = useT();
  const rowId = props.rows[0]?.id ?? 0;
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
  const run: Run = useCallback(
    async (op) => {
      setBusy(true);
      const r = await caseOpAction(rowId, op);
      setBusy(false);
      if (!r.ok) return void toast(r.error, { tone: "error" });
      if (r.message) toast(r.message);
      await load();
    },
    [rowId, load],
  );
  const data = useMemo(() => (d ? { ...caseAppData(d, { t, busy, locale: typeof navigator !== "undefined" ? navigator.language : undefined }), run } : { loading: true, error }), [d, t, busy, run, error]);
  return { data, reload: () => void load() };
}

const bundleOf = (p: PartProps) => (p.app.bundle as CaseBundle | undefined) ?? null;
const runOf = (p: PartProps) => p.app.run as Run;

/** The status, saved at once. */
/** What happened with the case (the Timeline plugin): its mails and letters, payments, todos, its row's changes — nothing while that plugin is off. */
function TimelinePart(p: PartProps) {
  const t = useT();
  const row = p.rows[0]?.id;
  return row ? <TimelineList row={row} limit={20} compact filters={false} title={t("Timeline")} hideWhenOff /> : null;
}

/** What you should know about the case now (the know plugin) — nothing while it is off or there is nothing to say. */
function KnowPart(p: PartProps) {
  const row = p.rows[0]?.id;
  return row ? <KnowPanel row={row} compact /> : null;
}

function StatusPart(p: PartProps) {
  const t = useT();
  const d = bundleOf(p);
  if (!d) return null;
  return (
    <select className="input w-auto" value={d.status} onChange={(e) => void runOf(p)({ op: "status", status: e.target.value })} aria-label={t("Status")}>
      <option value="open">{t("Open")}</option>
      <option value="closed">{t("Closed")}</option>
      <option value="ignored">{t("Not a case")}</option>
    </select>
  );
}

/** Its mails, letters, appointments — as a todo's sources are shown, unfolded. */
function SourcesPart(p: PartProps) {
  const d = bundleOf(p);
  return d?.sources.length ? <TodoSources list={d.sources} startOpen /> : null;
}

/** The payment as a GiroCode: the instalment (else what is open) as the amount to start with — yours to change. */
function PayPart(p: PartProps) {
  const pay = bundleOf(p)?.payment;
  return pay ? <Pay key={`${pay.iban}:${pay.amount}`} name={pay.name} iban={pay.iban} bic={pay.bic} purpose={pay.purpose} suggested={pay.amount} /> : null;
}

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

/** A party's contact, chosen from your contacts or made new (role, label, hint: the template's). */
function ContactPart(p: PartProps) {
  const d = bundleOf(p);
  const role = p.attrs.role as PartyRole;
  if (!d || !["creditor", "collector", "payee"].includes(role)) return null;
  const run = runOf(p);
  return <ContactField contacts={d.people} value={d.parties[role]?.personId ?? null} label={p.attrs.label ?? role} placeholder={p.attrs.hint} onPick={(id) => void run({ op: "party", role, personId: id })} onNew={(name, kind) => void run({ op: "newParty", role, name, kind })} />;
}

/** Your note, saved when you leave it. */
function NotePart(p: PartProps) {
  const d = bundleOf(p);
  return d ? <Note note={d.note} onSave={(note) => runOf(p)({ op: "note", note })} /> : null;
}

function Note({ note, onSave }: { note: string; onSave: (note: string) => Promise<void> }) {
  const t = useT();
  const [v, setV] = useState(note);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the note as saved elsewhere follows
  useEffect(() => setV(note), [note]);
  return <textarea className="input min-h-24" value={v} aria-label={t("Note")} onChange={(e) => setV(e.target.value)} onBlur={() => v !== note && void onSave(v)} placeholder={t("What you want to remember about this case")} />;
}

const page: ViewAppModule = {
  parts: { "case.know": KnowPart, "case.timeline": TimelinePart, "case.status": StatusPart, "case.sources": SourcesPart, "case.pay": PayPart, "case.contact": ContactPart, "case.note": NotePart },
  useAppData: useCaseData,
  actions: { "case.compile": (env) => void (env.app.run as Run | undefined)?.({ op: "compile" }) },
};
export default page;
