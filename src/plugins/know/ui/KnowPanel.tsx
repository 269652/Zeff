"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { kindIcon } from "@/plugins/timeline/shared";
import { knowBriefAction, knowRateAction, knowSummarizeAction, type KnowAnswer, type KnowQuery } from "../server-actions";
import { briefEmpty, type BriefLink } from "../shared";

/**
 * "What you should know" (the know plugin): the brief of a meeting (`event`), a Workspace row (`row`: a mail, a chat, a ticket, a
 * person, a case) or refs, read when it is shown — the AI's points on top when they are kept (made on request: "Sum up"), then the
 * people, what is open between you, what it is about, the latest, a line for sources not up to date. Each thing links to where it
 * is. Nothing at all while the plugin is off or there is nothing to say (unless `showEmpty`).
 */
export function KnowPanel({ event, occurrence, row, refs, title, compact = false, showEmpty = false }: KnowQuery & { title?: string; compact?: boolean; showEmpty?: boolean }) {
  const t = useT();
  const [a, setA] = useState<KnowAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [rated, setRated] = useState<boolean | null>(null);
  const [more, setMore] = useState(false);
  const refsKey = (refs ?? []).join(",");

  useEffect(() => {
    let live = true;
    void knowBriefAction({ event, occurrence, row, refs: refsKey ? refsKey.split(",") : undefined }).then((r) => live && setA(r));
    return () => {
      live = false;
    };
  }, [event, occurrence, row, refsKey]);

  if (!a) return compact ? null : <p className="text-sm text-zinc-400">…</p>;
  if (!a.ok) return a.off ? null : <p className="text-sm text-red-600">{a.error}</p>;
  const b = a.brief;
  if (briefEmpty(b) && !b.stale.length && !showEmpty) return null;

  const summarize = async (again: boolean) => {
    setBusy(true);
    const r = await knowSummarizeAction({ event, occurrence, row, refs }, again);
    setBusy(false);
    setRated(null);
    if (r.ok) setA(r);
  };
  const rate = (helpful: boolean) => {
    setRated(helpful);
    void knowRateAction(a.key, helpful);
  };
  const s = a.summary;
  const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00` : iso).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
  const euro = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "EUR" });
  const chip = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs";
  const link = (l: BriefLink, cls = "") =>
    l.href ? (
      <a key={l.ref} href={l.href} className={`hover:underline ${cls}`} {...(/^https?:/.test(l.href) ? { target: "_blank", rel: "noreferrer" } : {})}>
        {l.label}
      </a>
    ) : (
      <span key={l.ref} className={cls}>
        {l.label}
      </span>
    );
  const loopsMine = b.loops.filter((l) => l.direction === "mine");
  const loopsTheirs = b.loops.filter((l) => l.direction !== "mine");
  const recent = b.recent.slice(0, compact && !more ? 3 : 8);

  return (
    <section className="space-y-2.5 rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-sm dark:border-amber-900/70 dark:bg-amber-950/20" data-know aria-label={title ?? t("What you should know")}>
      <h3 className="flex items-center justify-between gap-2 text-xs font-semibold tracking-wide text-amber-800 uppercase dark:text-amber-300">
        <span>💡 {title ?? t("What you should know")}</span>
        {a.canSummarize && !briefEmpty(b) && (
          <button type="button" className="btn btn-sm normal-case" disabled={busy} onClick={() => void summarize(!!s?.current)} title={t("The AI sums up what is below in a few points — again only when something changed")}>
            {busy ? "…" : s?.current ? t("Sum up again") : t("Sum up")}
          </button>
        )}
      </h3>

      {b.stale.length > 0 && (
        <p className="text-xs text-amber-800 dark:text-amber-300">
          ⚠ {t("Not up to date: {sources} — this may be missing things.", { sources: b.stale.map((x) => x.label).join(", ") })}
        </p>
      )}

      {s && s.points.length > 0 && (
        <div className="space-y-1 rounded-md bg-white/70 p-2 dark:bg-black/20">
          <ul className="list-disc space-y-0.5 pl-4">
            {s.points.map((p, i) => (
              <li key={i}>
                {p.text}{" "}
                <span className="text-xs text-zinc-500">
                  ({p.sources.map((x, j) => (
                    <span key={`${x.ref}:${j}`}>
                      {j > 0 && ", "}
                      {link(x, "text-indigo-600 dark:text-indigo-400")}
                    </span>
                  ))})
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>{s.current ? t("AI summary · {when}", { when: day(s.at) }) : t("AI summary from before the latest changes")}</span>
            {rated === null ? (
              <>
                <button type="button" className="icon-btn" aria-label={t("Helpful")} title={t("Helpful")} onClick={() => rate(true)}>
                  👍
                </button>
                <button type="button" className="icon-btn" aria-label={t("Not helpful")} title={t("Not helpful")} onClick={() => rate(false)}>
                  👎
                </button>
              </>
            ) : (
              <span>{t("Thanks — noted.")}</span>
            )}
          </div>
        </div>
      )}

      {b.people.length > 0 && (
        <ul className="space-y-1.5">
          {b.people.map((p) => (
            <li key={p.id} className="space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {link({ ref: p.ref, label: p.name, href: p.href }, "font-medium")}
                {p.role && <span className="text-xs text-zinc-500">{p.role}</span>}
                {p.away && <span className={`${chip} bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}>{t("away until {day}", { day: day(p.away.until) })}</span>}
                {p.birthday && (
                  <span className={`${chip} bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200`}>
                    🎂 {p.birthday.inDays === 0 ? t("{what} today", { what: p.birthday.label }) : t("{what} in {n} days", { what: p.birthday.label, n: p.birthday.inDays })}
                  </span>
                )}
                {p.money?.owe ? <span className={`${chip} bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200`}>{t("you owe {amount}", { amount: euro(p.money.owe) })}</span> : null}
                {p.money?.owed ? <span className={`${chip} bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200`}>{t("owes you {amount}", { amount: euro(p.money.owed) })}</span> : null}
              </div>
              {p.lastContact && (
                <p className="truncate text-xs text-zinc-500">
                  {t("Last: {when}", { when: day(p.lastContact.at) })} · {kindIcon(p.lastContact.kind)} {p.lastContact.title}
                </p>
              )}
              {p.facts.length > 0 && (
                <ul className="text-xs text-zinc-600 dark:text-zinc-400">
                  {p.facts.slice(0, compact && !more ? 2 : 6).map((f, i) => (
                    <li key={i} className="truncate" title={f.source ? `${f.source} · ${f.at}` : f.at}>
                      · {f.text}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {b.loops.length > 0 && (
        <div className="space-y-1">
          {loopsMine.length > 0 && <p className="text-xs font-medium text-zinc-500">{t("You owe")}</p>}
          <ul className="space-y-0.5">
            {loopsMine.map((l) => (
              <li key={l.id} className="flex items-baseline gap-2" title={l.evidence}>
                <span className="min-w-0 flex-1">
                  {l.text} <span className="text-xs text-zinc-500">({l.personName})</span>
                </span>
                {l.due && <span className={`shrink-0 text-xs ${l.overdue ? "font-medium text-red-600 dark:text-red-400" : "text-zinc-500"}`}>{l.overdue ? t("overdue since {day}", { day: day(l.due) }) : t("due {day}", { day: day(l.due) })}</span>}
              </li>
            ))}
          </ul>
          {loopsTheirs.length > 0 && <p className="text-xs font-medium text-zinc-500">{t("Owed to you")}</p>}
          <ul className="space-y-0.5">
            {loopsTheirs.map((l) => (
              <li key={l.id} className="flex items-baseline gap-2" title={l.evidence}>
                <span className="min-w-0 flex-1">
                  {l.text} <span className="text-xs text-zinc-500">({l.personName})</span>
                </span>
                {l.due && <span className={`shrink-0 text-xs ${l.overdue ? "font-medium text-red-600 dark:text-red-400" : "text-zinc-500"}`}>{l.overdue ? t("overdue since {day}", { day: day(l.due) }) : t("due {day}", { day: day(l.due) })}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {b.related.length > 0 && (
        <div role="group" className="flex flex-wrap gap-1" aria-label={t("About")}>
          {b.related.map((r) => (
            <span key={r.ref} className={`${chip} max-w-full truncate border border-zinc-200 bg-white/70 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300`}>
              {link(r)}
            </span>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {recent.map((e) => (
            <li key={e.id} className="flex items-baseline gap-1.5">
              <span aria-hidden>{kindIcon(e.kind)}</span>
              <span className="shrink-0 text-zinc-500 tabular-nums">{day(e.at)}</span>
              {e.href ? (
                <a href={e.href} className="min-w-0 truncate hover:underline" {...(/^https?:/.test(e.href) ? { target: "_blank", rel: "noreferrer" } : {})} title={e.summary || e.title}>
                  {e.title}
                </a>
              ) : (
                <span className="min-w-0 truncate" title={e.summary || e.title}>
                  {e.title}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {compact && !more && (b.recent.length > 3 || b.people.some((p) => p.facts.length > 2)) && (
        <button type="button" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setMore(true)}>
          {t("More")}
        </button>
      )}

      {briefEmpty(b) && <p className="text-xs text-zinc-500">{t("Nothing known about it yet.")}</p>}
      {b.hidden > 0 && <p className="text-xs text-zinc-400">{t("{n} secret item(s) left out.", { n: b.hidden })}</p>}
    </section>
  );
}
