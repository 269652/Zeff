"use client";

import { Fragment, useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { askNewsAction } from "./server-actions";

export type Source = { n: number; id: number; title: string; url: string; sourceName: string };

/** The answer with its [1], [2] as small links to the sources (the ones that exist; others stay as text). */
export function Cited({ text, sources }: { text: string; sources: Source[] }) {
  return (
    <>
      {text.split(/(\[\d{1,2}\])/g).map((part, i) => {
        const n = Number(part.match(/^\[(\d{1,2})\]$/)?.[1]);
        const s = n ? sources.find((x) => x.n === n) : undefined;
        return s ? (
          <a key={i} href={s.url} target="_blank" rel="noreferrer noopener" title={`${s.sourceName}: ${s.title}`} className="align-super text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
            [{n}]
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </>
  );
}

/**
 * Ask your news: a question answered from the news Zeff has fetched — headlines and the articles it has read — with the
 * sources it used as links. Like asking a notebook: it says what the news say, and when they say nothing.
 */
export function AskNews() {
  const t = useT();
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ answer: string; sources: Source[]; q: string } | null>(null);
  const [error, setError] = useState("");

  return (
    <details className="card p-3 text-sm">
      <summary className="cursor-pointer font-medium">💬 {t("Ask your news")}</summary>
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length < 3) return;
          start(async () => {
            setError("");
            const r = await askNewsAction(q);
            if (r.ok) setRes({ answer: r.answer ?? "", sources: r.sources ?? [], q });
            else setError(r.error ?? t("Didn't work."));
          });
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Ask the news")} placeholder={t("e.g. What is new in quantum computing this week?")} className="min-w-[14rem] flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <button className="btn btn-primary btn-sm" disabled={pending}>
          {pending ? t("Reading the news …") : t("Ask")}
        </button>
      </form>
      {error && <p role="alert" className="alert-error mt-2 text-sm">{error}</p>}
      {res && (
        <div className="mt-3 space-y-2">
          <p className="leading-relaxed whitespace-pre-line">
            <Cited text={res.answer} sources={res.sources} />
          </p>
          {res.sources.length > 0 && (
            <ul className="space-y-0.5 text-xs text-zinc-500">
              {res.sources.map((s) => (
                <li key={s.id}>
                  [{s.n}]{" "}
                  <a href={s.url} target="_blank" rel="noreferrer noopener" className="hover:underline">
                    {s.title}
                  </a>{" "}
                  — {s.sourceName}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}
