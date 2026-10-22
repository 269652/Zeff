"use client";

import { Fragment, useMemo } from "react";
import { useT } from "@/components/I18nProvider";
import { CopyButton } from "@/components/CopyButton";
import { qrMatrix, qrPath } from "@/lib/girocode";
import { revolutLink, revolutPhoneLinks } from "../actions";

/**
 * A payment by RevTag, in its todo's card: their revolut.me page with the amount and the note in it — a click here opens it; the
 * phone gets a code of its own (iPhone, Android), which opens it in the phone's browser: the Revolut app would take the link and
 * drop the amount and the note, the page fills both in. Beside it the same to copy.
 */

/** A QR code of `text`, small, with what it is for under it. */
function Code({ text, label, title }: { text: string; label: string; title: string }) {
  const m = useMemo(() => {
    try {
      return qrMatrix(text);
    } catch {
      return null;
    }
  }, [text]);
  if (!m) return null;
  const n = m.length + 8;
  return (
    <span className="block shrink-0 space-y-1 text-center" title={title}>
      <svg viewBox={`0 0 ${n} ${n}`} width={128} height={128} shapeRendering="crispEdges" role="img" aria-label={title} className="rounded-md ring-1 ring-zinc-200 dark:ring-zinc-700">
        <rect width={n} height={n} fill="#fff" />
        <path d={qrPath(m)} fill="#000" />
      </svg>
      <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">{label}</span>
    </span>
  );
}
export function RevolutCard({ op }: { op: { name: string; revtag: string; amount: string; note: string } }) {
  const t = useT();
  const url = revolutLink(op.revtag, op.amount, op.note);
  const phone = revolutPhoneLinks(op.revtag, op.amount, op.note);
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
      {/* A code per phone: each opens the page in that phone's browser (the Revolut app would drop the amount and the note). */}
      <span className="flex shrink-0 flex-col items-center gap-1">
        <span className="flex gap-3">
          <Code text={phone.ios} label="iPhone" title={t("Scan with the iPhone's camera — opens in Safari with the amount and the note")} />
          <Code text={phone.android} label="Android" title={t("Scan with the Android camera — opens in Chrome with the amount and the note")} />
        </span>
        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
          {t("Opens {name}'s Revolut page", { name: op.name })} ↗
        </a>
      </span>
    </span>
  );
}
