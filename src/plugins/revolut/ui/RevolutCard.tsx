"use client";

import { Fragment, useMemo } from "react";
import { useT } from "@/components/I18nProvider";
import { CopyButton } from "@/components/CopyButton";
import { qrMatrix, qrPath } from "@/lib/girocode";

/**
 * A payment by RevTag, in its todo's card: a QR code of their revolut.me page — scanned with the phone it opens the payment in
 * the Revolut app, like a GiroCode does in a banking app (a GiroCode itself needs an IBAN) — and beside it what to copy: the
 * tag, the amount, the note.
 */
export function RevolutCard({ op }: { op: { name: string; revtag: string; amount: string; note: string } }) {
  const t = useT();
  const url = `https://revolut.me/${op.revtag}`;
  const m = useMemo(() => {
    try {
      return qrMatrix(url);
    } catch {
      return null;
    }
  }, [url]);
  const n = (m?.length ?? 0) + 8;
  const amount = op.amount ? Number(op.amount).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
  const fields = [
    { label: t("Recipient"), value: op.name, copy: op.name },
    { label: "RevTag", value: `@${op.revtag}`, copy: `@${op.revtag}`, mono: true },
    ...(amount ? [{ label: t("Amount"), value: `${amount} €`, copy: amount }] : []),
    ...(op.note ? [{ label: t("Note"), value: op.note, copy: op.note }] : []),
  ];
  return (
    <span className="mt-1 flex flex-wrap items-start gap-4" data-revolut-card>
      <dl className="grid min-w-56 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 text-sm">
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
      {m && (
        <a href={url} target="_blank" rel="noreferrer" className="shrink-0 space-y-1 text-center" title={t("Opens {name}'s Revolut page", { name: op.name })}>
          <svg viewBox={`0 0 ${n} ${n}`} width={140} height={140} shapeRendering="crispEdges" role="img" aria-label={t("Revolut code")} className="rounded-md ring-1 ring-zinc-200 dark:ring-zinc-700">
            <rect width={n} height={n} fill="#fff" />
            <path d={qrPath(m)} fill="#000" />
          </svg>
          <span className="block text-xs text-zinc-500">{t("Scan with your phone — opens Revolut")}</span>
        </a>
      )}
    </span>
  );
}
