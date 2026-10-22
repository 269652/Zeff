import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { SubmitButton } from "@/components/SubmitButton";
import { t } from "@/lib/i18n/server";
import { aiQualityView, type AiQualityView } from "@/lib/learning";
import { MIN_FOR_RATE } from "@/lib/learning/quality";
import { RULE_THRESHOLD, type LearnedRule } from "@/lib/learning/rules";
import { backfillAction, decideRuleAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("AI quality") };
}

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)} %`);
const day = (iso: string) => iso.slice(0, 10);

/** A link to what an item of the ledger is, where Zeff has a page for it. */
function itemHref(ref: string): string | null {
  const [kind, id] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)];
  if (kind === "todo") return `/t/${id}`;
  if (kind === "page") return `/workspace/${id}`;
  return null;
}

/**
 * AI quality: which AI step is useful and which is noise — counted from your decisions (the feedback ledger: what you
 * accepted, rejected, edited of each step's proposals), no AI. With the patterns you reject most and the rules
 * repetition suggests: you confirm them, the step applies them.
 */
export default async function AiQualityPage() {
  await connection();
  const v = aiQualityView();
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("AI quality")}</h1>
        <p className="text-sm text-zinc-500">
          {t(
            "How useful each AI step is, from what you did with its proposals: accepted, rejected, changed by you. The rate is accepted ÷ (accepted + rejected + edited) — shown from {n} decisions on. Counted, not judged by an AI.",
            { n: MIN_FOR_RATE },
          )}
        </p>
        <p className="text-sm text-zinc-500">
          <Link href="/settings/prompts#qualitaet" className="text-indigo-600 hover:underline dark:text-indigo-400">
            {t("What became of each step's todos")}
          </Link>
        </p>
      </div>
      <Steps v={v} />
      <Rules v={v} />
      <Patterns v={v} />
      <form action={backfillAction} className="text-sm text-zinc-500">
        <SubmitButton className="btn" pendingText={t("Reading…")}>
          {t("Read past decisions again")}
        </SubmitButton>{" "}
        {t("From the todos' history, the booking suggestions and People — nothing is counted twice.")}
      </form>
    </div>
  );
}

function Steps({ v }: { v: AiQualityView }) {
  return (
    <section id="steps" className="card scroll-mt-4 space-y-3 p-4">
      <h2 className="font-medium">{t("Acceptance per step")}</h2>
      {v.steps.length ? (
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th scope="col">{t("Step")}</th>
                <th scope="col" className="text-right">{t("7 days")}</th>
                <th scope="col" className="text-right">{t("30 days")}</th>
                <th scope="col" className="text-right">{t("90 days")}</th>
                <th scope="col" className="text-right" title={t("The last 30 days against the 30 before")}>
                  {t("Trend")}
                </th>
                <th scope="col" className="text-right" title={t("Accepted / rejected / edited / ignored, last 90 days")}>
                  {t("Decisions (90 days)")}
                </th>
              </tr>
            </thead>
            <tbody>
              {v.steps.map((s) => {
                const w90 = s.windows[2];
                return (
                  <tr key={s.step}>
                    <td className="whitespace-nowrap">{v.labels[s.step] ?? s.step}</td>
                    {s.windows.map((w) => (
                      <td key={w.days} className={`text-right tabular-nums ${w.rate !== null && w.rate < 0.5 ? "text-red-600 dark:text-red-400" : ""}`} title={t("{n} decisions", { n: w.total })}>
                        {pct(w.rate)}
                      </td>
                    ))}
                    <td className={`text-right tabular-nums ${s.trend === null ? "text-zinc-400" : s.trend < 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
                      {s.trend === null ? "–" : `${s.trend >= 0 ? "+" : "−"}${Math.abs(Math.round(s.trend * 100))}`}
                    </td>
                    <td className="text-right whitespace-nowrap text-zinc-500 tabular-nums">
                      {w90.total} <span className="text-xs">({w90.accepted} ✓ · {w90.rejected} ✗ · {w90.edited} ✎{w90.ignored ? ` · ${w90.ignored} –` : ""})</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-zinc-400">{t("No decisions yet — they are counted from now on as you accept or reject what the AI proposes.")}</p>
      )}
    </section>
  );
}

function Evidence({ r }: { r: LearnedRule }) {
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-zinc-500">
      {r.evidence.map((e) => {
        const href = itemHref(e.itemRef);
        return (
          <li key={`${e.itemRef}-${e.at}`}>
            {day(e.at)} ·{" "}
            {href ? (
              <Link href={href} className="hover:underline">
                {e.text}
              </Link>
            ) : (
              e.text
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RuleForm({ id, status, label, primary }: { id: number; status: "confirmed" | "dismissed"; label: string; primary?: boolean }) {
  return (
    <form action={decideRuleAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton className={primary ? "btn btn-primary" : "btn"}>{label}</SubmitButton>
    </form>
  );
}

function Rules({ v }: { v: AiQualityView }) {
  return (
    <section id="rules" className="card scroll-mt-4 space-y-3 p-4">
      <div>
        <h2 className="font-medium">{t("Rules from repetition")}</h2>
        <p className="text-sm text-zinc-500">
          {t(
            "When you reject the same kind from the same sender {n} times and never accept one, Zeff proposes a rule: the step leaves such messages alone. Never for must-do mails (mandatory trainings, signatures), chats, questions to you or conversations you take part in.",
            { n: RULE_THRESHOLD },
          )}
        </p>
      </div>
      {v.proposed.length === 0 && v.confirmed.length === 0 && <p className="text-sm text-zinc-400">{t("No rule proposed yet.")}</p>}
      <ul className="space-y-3">
        {v.proposed.map((r) => (
          <li key={r.id} className="rounded border border-amber-300 p-3 dark:border-amber-700">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm">
                <span className="text-xs text-zinc-500">{v.labels[r.step] ?? r.step} · </span>
                {t("Leave alone: from {sender}, like “{kind}”", { sender: r.sender, kind: r.kind })}
                <span className="text-xs text-zinc-500"> — {t("rejected {n}×", { n: r.evidence.length })}</span>
              </div>
              <div className="flex gap-2">
                <RuleForm id={r.id} status="confirmed" label={t("Confirm rule")} primary />
                <RuleForm id={r.id} status="dismissed" label={t("Dismiss")} />
              </div>
            </div>
            <Evidence r={r} />
          </li>
        ))}
        {v.confirmed.map((r) => (
          <li key={r.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm">
                <span className="text-xs text-zinc-500">{v.labels[r.step] ?? r.step} · </span>
                {t("Leave alone: from {sender}, like “{kind}”", { sender: r.sender, kind: r.kind })}
                <span className="text-xs text-green-700 dark:text-green-400"> — {t("on since {date}", { date: day(r.decidedAt ?? r.createdAt) })}</span>
              </div>
              <RuleForm id={r.id} status="dismissed" label={t("Take back")} />
            </div>
            <Evidence r={r} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Patterns({ v }: { v: AiQualityView }) {
  return (
    <section id="patterns" className="card scroll-mt-4 space-y-3 p-4">
      <h2 className="font-medium">{t("Most rejected (90 days)")}</h2>
      {v.patterns.length ? (
        <ul className="space-y-2 text-sm">
          {v.patterns.map((p) => (
            <li key={`${p.step}|${p.sender}|${p.kind}`}>
              <div>
                <span className="text-xs text-zinc-500">{v.labels[p.step] ?? p.step} · </span>
                {[p.sender, p.kind].filter(Boolean).join(" · ")}
                <span className="text-xs text-zinc-500">
                  {" "}
                  — {t("rejected {n}×", { n: p.rejected })}
                  {p.accepted ? `, ${t("accepted {n}×", { n: p.accepted })}` : ""}
                </span>
              </div>
              <div className="text-xs text-zinc-500">{p.examples.map((e) => `„${e.text}“`).join(" · ")}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-400">{t("Nothing rejected twice from the same sender and kind.")}</p>
      )}
    </section>
  );
}
