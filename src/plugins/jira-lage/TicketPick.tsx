"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import type { DbSchema, Row } from "@/plugins/workspace/model";
import type { TicketsEmbed } from "@/plugins/workspace/chat-embed";
import { boardTickets, pickTickets, type PickResult, type PickCriteria, type PickGroupId } from "./pick";

/**
 * "Find tickets for me" on a mirrored Jira board (the database view): a toggle — on, the board shows only your unfinished
 * tickets and the candidates from Ready (pick.ts), with a banner that says so (the counts, "Show all") and lists your
 * unfinished ones first. Remembered per board in this browser. The assistant's filter (?pick=… in the address) shows the same
 * way. And the tickets the assistant showed, drawn under its answer (TicketsEmbedCard).
 */

const KEY = (dbId: number) => `zeff.jira.forMe.${dbId}`;

/** Whether "for me" is on for this board (this browser), and the switch. */
export function useForMe(dbId: number): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- remembered in the browser, read after the first render
      setOn(localStorage.getItem(KEY(dbId)) === "1");
    } catch {
      // not remembered
    }
  }, [dbId]);
  const set = (v: boolean) => {
    setOn(v);
    try {
      if (v) localStorage.setItem(KEY(dbId), "1");
      else localStorage.removeItem(KEY(dbId));
    } catch {
      // not remembered
    }
  };
  return [on, set];
}

/** The pick for a board's rows (null: no filter). */
export function useTicketPick(schema: DbSchema | undefined, rows: Row[] | undefined, me: string[], criteria: PickCriteria | null): PickResult | null {
  return useMemo(() => {
    if (!criteria || !schema || !rows) return null;
    const { columns, tickets } = boardTickets(schema, rows);
    return pickTickets(columns, tickets, me, criteria);
  }, [schema, rows, me, criteria]);
}

const chip = (on: boolean) =>
  `inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs transition ${on ? "bg-indigo-600 text-white dark:bg-indigo-500" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"}`;

/** The toggle, and — while a filter is on — the banner: what it shows, how many, your unfinished tickets first, "Show all". */
export function TicketPickBar({ on, onToggle, pick, criteria, meKnown, openRow, onOff }: { on: boolean; onToggle: () => void; pick: PickResult | null; criteria: PickCriteria | null; meKnown: boolean; openRow: (id: number) => void; onOff: () => void }) {
  const t = useT();
  const count = (id: PickGroupId) => pick?.groups.find((g) => g.id === id)?.total ?? 0;
  const mine = pick?.groups.find((g) => g.id === "mine")?.tickets ?? [];
  const forMe = !!criteria?.forMe;
  return (
    <div className="space-y-1.5" data-ticket-pick>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={chip(on)} aria-pressed={on} onClick={onToggle} title={t("Only your unfinished tickets and what is ready to pick up")}>
          🎯 {t("Find tickets for me")}
        </button>
      </div>
      {pick && criteria && (
        <div role="status" className="space-y-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-100">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium">{forMe ? t("Tickets for you") : (criteria.title ?? t("Filtered by the assistant"))}</span>
            <span className="text-xs">
              {forMe
                ? `${t("{n} still open for you", { n: count("mine") })} · ${t("{n} ready to pick up", { n: count("ready") })}`
                : count("match") === 1
                  ? t("1 ticket matches")
                  : t("{n} tickets match", { n: count("match") })}
            </span>
            <button type="button" className="ml-auto text-xs font-medium underline-offset-2 hover:underline" onClick={onOff}>
              {t("Show all")}
            </button>
          </div>
          {criteria.reason && <p className="text-xs">{criteria.reason}</p>}
          {forMe && mine.length > 0 && (
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("Still open for you")}>
              <span className="text-xs font-medium">{t("Still open for you")}:</span>
              {mine.map((x) => (
                <button key={x.id} type="button" className="inline-flex max-w-72 items-center gap-1 rounded-full border border-indigo-300 bg-white px-2 py-0.5 text-xs text-zinc-800 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-indigo-900" onClick={() => openRow(x.id)} title={`${x.key} ${x.title} — ${x.status}`}>
                  <span className="font-mono">{x.key}</span>
                  <span className="truncate">{x.title}</span>
                  <span className="shrink-0 text-zinc-600 dark:text-zinc-300">· {x.status}</span>
                </button>
              ))}
            </div>
          )}
          {forMe && !meKnown && <p className="text-xs">{t("Zeff doesn't know your Jira name yet — use “Assign to me” on a card once; until then only unassigned tickets show.")}</p>}
          {forMe && pick.ready.length === 0 && <p className="text-xs">{t("This board has no Ready column — nothing to pick up from.")}</p>}
        </div>
      )}
    </div>
  );
}

/** A filtered board the assistant showed, under its answer: the tickets by group, each opening its card; the board with the filter. */
export function TicketsEmbedCard({ embed }: { embed: TicketsEmbed }) {
  const t = useT();
  const groups: Record<PickGroupId, string> = { mine: t("Still open for you"), ready: t("Ready to pick up"), match: t("Matching tickets") };
  const title = embed.criteria.forMe ? t("Tickets for you") : (embed.criteria.title ?? t("Filtered by the assistant"));
  return (
    <div className="space-y-1.5 rounded-lg border border-zinc-200 bg-white p-2 text-xs dark:border-zinc-700 dark:bg-zinc-900" data-tickets-embed>
      <div className="flex items-baseline gap-2">
        <span className="font-medium text-zinc-900 dark:text-zinc-100">🎯 {title}</span>
        <span className="truncate text-zinc-600 dark:text-zinc-300">{embed.board}</span>
      </div>
      {embed.criteria.reason && <p className="text-zinc-600 dark:text-zinc-300">{embed.criteria.reason}</p>}
      {embed.groups.map((g) => (
        <div key={g.id} className="space-y-0.5">
          {(embed.groups.length > 1 || g.id !== "match") && (
            <p className="font-medium text-zinc-700 dark:text-zinc-200">
              {groups[g.id]} ({g.total})
            </p>
          )}
          {g.tickets.length === 0 && <p className="text-zinc-600 dark:text-zinc-300">{t("None")}</p>}
          <ul className="space-y-0.5">
            {g.tickets.slice(0, 12).map((x) => (
              <li key={x.rowId}>
                <Link href={`/workspace/${embed.dbId}?row=${x.rowId}`} className="block rounded px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <span className="flex items-baseline gap-1.5">
                    <span className="shrink-0 font-mono text-zinc-600 dark:text-zinc-300">{x.key}</span>
                    <span className="line-clamp-2 min-w-0 flex-1 text-zinc-900 dark:text-zinc-100">{x.title}</span>
                  </span>
                  <span className="block text-zinc-600 dark:text-zinc-300">{[x.status, x.priority, x.mine ? t("you") : x.assignee || null].filter(Boolean).join(" · ")}</span>
                </Link>
              </li>
            ))}
          </ul>
          {g.total > Math.min(g.tickets.length, 12) && <p className="text-zinc-600 dark:text-zinc-300">{t("+{n} more on the board", { n: g.total - Math.min(g.tickets.length, 12) })}</p>}
        </div>
      ))}
      <Link href={embed.href} className="inline-block font-medium text-indigo-700 hover:underline dark:text-indigo-300">
        {t("Open the board filtered like this")} →
      </Link>
    </div>
  );
}
