import { formatHours, formatTime } from "@/lib/format";
import type { TicketCard } from "@/lib/jira/ticket-card-shared";
import type { RecapFact, RecapView as Recap } from "@/lib/runs/recap-shared";
import type { Entity } from "@/lib/entities-shared";
import { TicketLink } from "../TicketLink";
import { RecapSources } from "./RecapSources";
import { t } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/shared";

const KIND = (t: T): Record<RecapFact["kind"], { label: string; cls: string }> => ({
  entry: { label: t("Entry"), cls: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200" },
  todo: { label: t("Todo"), cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" },
  work: { label: t("Worker"), cls: "bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200" },
  "jira-comment": { label: "Jira", cls: "bg-jira-50 text-jira-800 dark:bg-jira-950/60 dark:text-jira-200" },
  "jira-change": { label: "Jira", cls: "bg-jira-50 text-jira-800 dark:bg-jira-950/60 dark:text-jira-200" },
  commit: { label: t("Commit"), cls: "bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200" },
  gitlab: { label: "GitLab", cls: "bg-orange-50 text-orange-800 dark:bg-orange-950/60 dark:text-orange-200" },
});

const time = (at: string | null) => (at ? formatTime(at) : "");
const hoursOf = (facts: RecapFact[]) => facts.reduce((s, f) => s + (f.hours ?? 0), 0);

/** Facts with no badge of their own (bookings, commits, workers' runs, Jira changes) — the rest are badges. */
const LINE_KINDS = new Set<RecapFact["kind"]>(["entry", "commit", "work", "jira-change"]);

/**
 * What it was written from, folded: the todos, messages, comments and merge requests as their
 * badges (each unfolds), then the bookings, commits, workers' runs and Jira changes as lines.
 */
function Facts({ facts, entities = [] }: { facts: RecapFact[]; entities?: Entity[] }) {
  const lines = entities.length ? facts.filter((f) => LINE_KINDS.has(f.kind)) : facts;
  if (!lines.length && !entities.length) return null;
  const kind = KIND(t);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-zinc-500">{t("Evidence ({n})", { n: entities.length + lines.length })}</summary>
      <div className="mt-1.5">
        <RecapSources entities={entities} />
      </div>
      <ul className="mt-1.5 space-y-1">
        {lines.map((f, i) => (
          <li key={i} className="flex items-baseline gap-2 text-xs text-zinc-600 dark:text-zinc-300">
            <span className="w-10 shrink-0 font-mono text-zinc-400">{time(f.at)}</span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${kind[f.kind].cls}`}>
              {kind[f.kind].label}
              {f.hours ? ` ${formatHours(f.hours)} h` : ""}
            </span>
            <span className="min-w-0 break-words">{f.text}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * A day's recap: the summary, then per ticket what was done (the AI's write-up, the ticket's
 * booked hours, what it was written from) — and the work on no ticket.
 */
export function RecapView({ recap, cards, entities = {} }: { recap: Recap; cards: Record<string, TicketCard>; entities?: Record<string, Entity[]> }) {
  const r = recap.result;
  const written = new Map((r?.tickets ?? []).map((x) => [x.key, x]));
  const booked = recap.facts.tickets.reduce((s, x) => s + hoursOf(x.facts), 0) + hoursOf(recap.facts.other);
  return (
    <div className="space-y-4">
      {r?.summary && (
        <section className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">
            {t("Summary")}{" "}
            {booked > 0 && <span className="font-normal normal-case text-zinc-400">· {t("{hours} h booked", { hours: formatHours(booked) })}</span>}
          </h2>
          <p className="max-w-[80ch] leading-relaxed whitespace-pre-line">{r.summary}</p>
        </section>
      )}
      {recap.facts.tickets.map((tk) => {
        const w = written.get(tk.key);
        const hours = hoursOf(tk.facts);
        return (
          <article key={tk.key} className="card space-y-2 p-4">
            <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <TicketLink ticket={tk.key} card={cards[tk.key]} className="font-mono text-sm font-semibold text-indigo-700 dark:text-indigo-300" />
              <span className="font-medium">{tk.summary || cards[tk.key]?.summary}</span>
              {tk.status && <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wide text-zinc-600 uppercase dark:bg-zinc-800 dark:text-zinc-300">{tk.status}</span>}
              {hours > 0 && <span className="ml-auto text-xs text-zinc-500">{t("{hours} h booked", { hours: formatHours(hours) })}</span>}
            </header>
            {w?.lead && <p className="font-medium">{w.lead}</p>}
            {!!w?.done.length && (
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
                {w.done.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
            <Facts facts={tk.facts} entities={entities[tk.key]} />
          </article>
        );
      })}
      {(!!r?.other.length || recap.facts.other.length > 0) && (
        <section className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">
            {t("No ticket")}{" "}
            {hoursOf(recap.facts.other) > 0 && (
              <span className="font-normal normal-case text-zinc-400">
                · {t("{hours} h booked", { hours: formatHours(hoursOf(recap.facts.other)) })}
              </span>
            )}
          </h2>
          {!!r?.other.length && (
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
              {r.other.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
          <Facts facts={recap.facts.other} />
        </section>
      )}
    </div>
  );
}
