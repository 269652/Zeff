"use client";

import { Fragment, useMemo } from "react";
import { useT } from "@/components/I18nProvider";
import { CopyButton } from "@/components/CopyButton";
import { epcPayload, qrMatrix, qrPath } from "@/lib/girocode";

/** An amount as German banking apps take it: "3.618,13". */
const euros = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A transfer as a GiroCode (EPC QR code) to scan with a banking app — black on white with its quiet zone, in dark
 * mode too — and its fields (recipient, IBAN, BIC, amount, purpose) to copy one by one, for an app that doesn't scan.
 */
export function GiroCode({ name, iban, bic, bank, amount, purpose, codeOnly = false }: { name: string; iban: string; bic?: string | null; bank?: string | null; amount?: number | null; purpose?: string | null; /** Only the code: the fields stand beside it (as inputs). */ codeOnly?: boolean }) {
  const t = useT();
  const qr = useMemo(() => {
    try {
      return { m: qrMatrix(epcPayload({ name, iban, bic, amount, purpose })), error: "" };
    } catch (err) {
      return { m: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [name, iban, bic, amount, purpose]);
  const n = (qr.m?.length ?? 0) + 8;
  const fields = [
    { label: t("Recipient"), value: name, copy: name },
    { label: "IBAN", value: iban, copy: iban.replace(/\s+/g, ""), mono: true },
    ...(bic ? [{ label: "BIC", value: bank ? `${bic} · ${bank}` : bic, copy: bic, mono: true }] : bank ? [{ label: t("Bank"), value: bank, copy: bank }] : []),
    ...(amount != null && amount > 0 ? [{ label: t("Amount"), value: `${euros(amount)} €`, copy: euros(amount) }] : []),
    ...(purpose?.trim() ? [{ label: t("Purpose"), value: purpose.trim(), copy: purpose.trim() }] : []),
  ];
  return (
    <div className="space-y-2">
      {qr.m ? (
        <figure className="space-y-1">
          <svg viewBox={`0 0 ${n} ${n}`} width={160} height={160} shapeRendering="crispEdges" role="img" aria-label={t("GiroCode")} className="rounded-md ring-1 ring-zinc-200 dark:ring-zinc-700">
            <rect width={n} height={n} fill="#fff" />
            <path d={qrPath(qr.m)} fill="#000" />
          </svg>
          <figcaption className="text-xs text-zinc-500">{t("Scan with your banking app")}</figcaption>
        </figure>
      ) : (
        <p className="text-xs text-red-600 dark:text-red-400">{t("No GiroCode: {error}", { error: qr.error })}</p>
      )}
      {!codeOnly && (
      <dl className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 text-sm">
        {fields.map((f) => (
          <Fragment key={f.label}>
            <dt className="text-xs text-zinc-500">{f.label}</dt>
            <dd className={`min-w-0 break-words ${f.mono ? "font-mono text-[13px]" : ""}`}>{f.value}</dd>
            <CopyButton text={f.copy} className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" title={t("Copy")}>
              ⧉
            </CopyButton>
          </Fragment>
        ))}
      </dl>
      )}
    </div>
  );
}
