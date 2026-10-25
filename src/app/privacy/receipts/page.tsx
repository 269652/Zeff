import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { listReceipts, receiptSummary } from "@/lib/ai/receipts";
import { ReceiptText } from "./ReceiptText";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("What went to the AI") };
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * What went to the AI, provably (lib/ai/receipts.ts): every text an AI step sent in the last 30 days — the step, the AI, how much,
 * the secret lines left out — each to open, and a month's report to download. Kept only here.
 */
export default async function ReceiptsPage() {
  await connection();
  const summary = receiptSummary();
  const list = listReceipts({ limit: 200 });
  const month = new Date().toISOString().slice(0, 7);
  const total = summary.reduce((s, r) => ({ calls: s.calls + r.calls, chars: s.chars + r.chars, redacted: s.redacted + r.redacted }), { calls: 0, chars: 0, redacted: 0 });
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/privacy" className="text-sm text-zinc-500 hover:underline">
          ← {t("What leaves this PC")}
        </Link>
        <h1 className="text-lg font-semibold">{t("What went to the AI")}</h1>
        <p className="text-sm text-zinc-500">{t("Every text an AI step sent in the last 30 days — to which AI, how much, and how many lines of secret sources were left out of it. Kept only on this PC, for 30 days.")}</p>
        <p className="text-sm">
          <a href={`/api/privacy/receipts?month=${month}`} className="text-indigo-600 hover:underline dark:text-indigo-400" download>
            ⬇ {t("This month as a report")}
          </a>
        </p>
        <p className="text-sm">
          <Link href="/privacy/boundaries" className="text-indigo-600 hover:underline dark:text-indigo-400">
            {t("Data flows")} →
          </Link>
        </p>
      </div>

      <div className="space-y-4">
        <section className="card space-y-2 p-4 text-sm">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("In 30 days")}</h2>
          <p>{t("{calls} texts · {chars} characters · {redacted} secret lines left out", { calls: total.calls, chars: total.chars.toLocaleString(), redacted: total.redacted })}</p>
          {summary.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500 uppercase">
                  <th className="py-1 font-semibold">{t("Step")}</th>
                  <th className="py-1 font-semibold">{t("AI")}</th>
                  <th className="py-1 text-right font-semibold">{t("Texts")}</th>
                  <th className="py-1 text-right font-semibold">{t("Characters")}</th>
                  <th className="py-1 text-right font-semibold">{t("Left out")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {summary.map((r) => (
                  <tr key={`${r.task}:${r.provider}`}>
                    <td className="py-1">{r.task}</td>
                    <td className="py-1">{r.provider}</td>
                    <td className="py-1 text-right tabular-nums">{r.calls}</td>
                    <td className="py-1 text-right tabular-nums">{r.chars.toLocaleString()}</td>
                    <td className="py-1 text-right tabular-nums">{r.redacted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card divide-y divide-zinc-100 p-0 text-sm dark:divide-zinc-800">
          {list.length === 0 ? (
            <p className="p-4 text-zinc-500">{t("Nothing went to an AI in the last 30 days.")}</p>
          ) : (
            list.map((r) => (
              <div key={r.id} className="space-y-1 px-4 py-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-xs text-zinc-500 tabular-nums">{when(r.at)}</span>
                  <span className="font-medium">{r.task}</span>
                  <span className="text-zinc-500">
                    {r.provider}
                    {r.model ? ` · ${r.model}` : ""} · {t("{n} characters", { n: r.chars.toLocaleString() })}
                  </span>
                  {r.redacted > 0 && <span className="text-xs text-emerald-700 dark:text-emerald-400">🔒 {t("{n} secret lines left out", { n: r.redacted })}</span>}
                </div>
                <ReceiptText id={r.id} />
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
