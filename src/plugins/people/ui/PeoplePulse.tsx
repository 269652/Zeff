"use client";

import type { ReactNode } from "react";
import { useT } from "@/components/I18nProvider";
import type { PeopleOverview, PeopleTool } from "../tools";
import { agoText } from "./PersonCard";

/**
 * Beside the people: the appointments with someone in the next 24 hours (a brief each — what came since you last met, what is
 * open, the cases), and who you haven't been in touch with for a while (write, or ask again later).
 */

export function Meetings({ meetings, person, now }: { meetings: PeopleOverview["meetings"]; person: (id: number, label: string) => ReactNode; now: number }) {
  const t = useT();
  if (!meetings.length) return null;
  const time = (s: string) => (s.length === 10 ? t("all day") : new Date(s).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }));
  return (
    <ul className="space-y-2">
      {meetings.map((m) => (
        <li key={`${m.eventId}-${m.personId}`}>
          <details className="group rounded-md border border-zinc-100 p-2 dark:border-zinc-800">
            <summary className="cursor-pointer list-none text-sm select-none">
              <span className="text-xs text-zinc-500">{time(m.start)} · </span>
              {person(m.personId, m.name)}
              <span className="block truncate text-xs text-zinc-500">{m.title}</span>
            </summary>
            <div className="mt-2 space-y-2 text-sm">
              <p className="text-xs text-zinc-500">{m.lastMet ? t("Last met {when}", { when: agoText(t, m.lastMet, now) }) : t("No appointment with them in the last year.")}</p>
              {m.since.length > 0 && (
                <div>
                  <h4 className="text-xs text-zinc-500">{m.lastMet ? t("Since then") : t("Lately")}</h4>
                  <ul className="space-y-0.5">
                    {m.since.map((s, i) => (
                      <li key={i} className="line-clamp-2">
                        <span className="text-xs text-zinc-400">{agoText(t, s.at, now)}: </span>
                        {s.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {m.owed.length > 0 && (
                <div>
                  <h4 className="text-xs text-zinc-500">{t("Open between you")}</h4>
                  <ul className="space-y-0.5">
                    {m.owed.map((o, i) => (
                      <li key={i}>
                        <span className={`text-xs ${o.direction === "mine" ? "text-rose-700 dark:text-rose-300" : "text-sky-700 dark:text-sky-300"}`}>{o.direction === "mine" ? t("you") : t("they")}: </span>
                        {o.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {m.cases.length > 0 && (
                <div>
                  <h4 className="text-xs text-zinc-500">{t("Cases")}</h4>
                  <ul className="space-y-0.5">
                    {m.cases.map((c) => (
                      <li key={c.label}>
                        {c.title} <span className="text-xs text-zinc-400">{c.label}</span>
                        {c.open != null && <span className="text-xs text-zinc-500"> · {t("open {amount}", { amount: c.open.toLocaleString(undefined, { style: "currency", currency: "EUR" }) })}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!m.since.length && !m.owed.length && !m.cases.length && <p className="text-xs text-zinc-400">{t("Nothing open with them.")}</p>}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

export function Nudges({ nudges, cards, person, run, busy }: { nudges: PeopleOverview["nudges"]; cards: PeopleOverview["cards"]; person: (id: number, label: string) => ReactNode; run: (tool: PeopleTool, key: string) => unknown; busy: boolean }) {
  const t = useT();
  if (!nudges.length) return null;
  const channel = (c: string) => (c === "Appointment" ? t("Appointment") : c);
  return (
    <ul className="space-y-2">
      {nudges.map((n) => {
        const card = cards[n.personId];
        const weeks = Math.floor(n.days / 7);
        return (
          <li key={n.personId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="min-w-0 flex-1">
              {person(n.personId, n.name)}
              <span className="block text-xs text-zinc-500">{t("{n} weeks without contact · last: {channel}", { n: weeks, channel: channel(n.channel) })}</span>
            </span>
            <span className="flex gap-1">
              {card?.chat ? (
                <a className="btn btn-primary btn-sm" href={`/mail?q=${encodeURIComponent(card.chat)}`}>
                  💬 {t("Write")}
                </a>
              ) : card?.email ? (
                <a className="btn btn-primary btn-sm" href={`mailto:${card.email}`}>
                  ✉ {t("Write")}
                </a>
              ) : null}
              <button type="button" className="btn btn-sm" disabled={busy} title={t("Ask again in two weeks")} onClick={() => void run({ tool: "snooze", id: n.personId, days: 14 }, `z${n.personId}`)}>
                {t("Later")}
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
