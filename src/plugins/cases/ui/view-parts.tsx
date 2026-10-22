"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { GiroCode } from "@/components/GiroCode";
import type { AppViewProps, PartProps, ViewAppModule } from "@/plugins/workspace/ui/app-view";
import { casesOverviewAction, type CasesOverview } from "../block-actions";
import { casesAppData } from "../view-data";
import { BankBar } from "./BankBar";

/**
 * The cases overview, client side: what its template reads as app.* (the overview, read when the view opens and after the bank
 * changed), and the parts it is built of where the language's tags aren't enough — the bank bar, a case's GiroCode.
 */

/** The overview worked out for the template (view-data.ts); state.paying: the case whose GiroCode is open. */
function useCasesData(_props: AppViewProps, state: Record<string, string>) {
  const t = useT();
  const [o, setO] = useState<CasesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  // Only the latest load counts.
  const load = useCallback(() => {
    const n = ++seq.current;
    void casesOverviewAction().then(
      (r) => n === seq.current && (r.ok ? setO(r.overview) : setError(r.error)),
      (e: unknown) => n === seq.current && setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);
  useEffect(load, [load]);
  // Today — fixed when the view opens.
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const paying = state.paying ?? "";
  const data = useMemo(() => (o ? casesAppData(o, { t, today, paying, locale: typeof navigator !== "undefined" ? navigator.language : undefined }) : { loading: true, error }), [o, t, today, paying, error]);
  return { data, reload: load };
}

const overviewOf = (p: PartProps) => (p.app.overview as CasesOverview | undefined) ?? null;

/** The bank bar: a statement read, the bank connected or synced — the overview read again after. */
function BankPart(p: PartProps) {
  return <BankBar onChanged={p.reloadApp} />;
}

/** A case's GiroCode, under its line. */
function GiroCodePart(p: PartProps) {
  const c = overviewOf(p)?.cases.find((x) => x.id === Number(p.attrs.case));
  if (!c?.payment) return null;
  return (
    <div className="max-w-sm pt-1">
      <GiroCode name={c.payment.name} iban={c.payment.iban} bic={c.payment.bic || null} amount={c.payment.amount} purpose={c.payment.purpose} />
    </div>
  );
}

const view: ViewAppModule = {
  parts: { "cases.bank": BankPart, "cases.girocode": GiroCodePart },
  useAppData: useCasesData,
};
export default view;
