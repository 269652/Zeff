import type { Metadata } from "next";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { resolveQuery } from "@/plugins/timeline/refs";
import { timelineSince } from "@/plugins/timeline/query";
import { lastSeen, timelineStats } from "@/plugins/timeline/store";
import { KIND_GROUPS, SOURCES } from "@/plugins/timeline/shared";
import { timelineHealthNote } from "@/plugins/timeline/health-note";
import { TimelineList } from "@/plugins/timeline/ui/TimelineList";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Timeline") };
}

/**
 * The Timeline: everything that happened, newest first, by day — filtered by kind, source and entity (a person, a ticket, a page …
 * by its name or ref) — with a line where your last visit was, and beside it what changed since then, by entity; a line when a
 * source it reads isn't well (stale, silent, failing — source health).
 */
export default async function TimelinePage({ searchParams }: { searchParams: Promise<{ ref?: string; kind?: string; source?: string }> }) {
  await connection();
  if (!isInstalled("timeline")) return <PluginNotInstalled id="timeline" />;
  const sp = await searchParams;
  const asked = (sp.ref ?? "").trim();
  const hit = asked ? resolveQuery(asked) : null;
  const kinds = (sp.kind ?? "").split(",").filter((k) => (KIND_GROUPS as readonly string[]).includes(k));
  const sources = (sp.source ?? "").split(",").filter((s) => (SOURCES as readonly string[]).includes(s));
  const seen = lastSeen("all");
  const since = timelineSince({ since: seen ?? "7d", limit: 12, perGroup: 1 });
  const stats = timelineStats();
  // A source it reads that isn't well (source health): one line — the timeline may miss what it brought.
  let healthNote: string | null = null;
  try {
    const { sourceHealth } = await import("@/lib/sync/source-health");
    healthNote = timelineHealthNote(await sourceHealth(), sources.length ? sources : Object.keys(stats.sources));
  } catch {
    healthNote = null;
  }
  const sinceList = (
    <ul className="space-y-0.5 text-sm">
      {since.ok &&
        since.groups.map((g) => (
          <li key={g.ref} className="flex items-baseline gap-2">
            <a href={`/timeline?ref=${encodeURIComponent(g.ref)}`} className="min-w-0 flex-1 truncate hover:underline">
              {g.label}
            </a>
            <span className="text-xs text-zinc-400 tabular-nums">{g.count}</span>
          </li>
        ))}
    </ul>
  );
  return (
    <div className="page">
      <div className="page-aside space-y-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">{t("Timeline")}</h1>
          <p className="text-sm text-zinc-500 max-lg:hidden">{t("What happened across your sources — mails, chats, tickets, appointments, time, todos, rows, payments, documents — and with whom. Read after every sync, by rule.")}</p>
          <p className="text-xs text-zinc-400">{t("{n} events", { n: stats.total })}</p>
          {healthNote && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              ⚠ {healthNote}
            </p>
          )}
        </div>
        <form method="get" className="space-y-1">
          <label className="label" htmlFor="tl-ref">
            {t("About")}
          </label>
          <div className="flex gap-1">
            <input id="tl-ref" name="ref" defaultValue={asked} className="input min-w-0 flex-1" placeholder={t("A person, a ticket key, a page …")} />
            <button className="btn btn-sm">{t("Show")}</button>
          </div>
          {asked && !hit && <p className="text-xs text-red-600">{t("Nothing known by “{q}”.", { q: asked })}</p>}
          {hit && (
            <p className="text-xs text-zinc-500">
              {hit.label} · <a href="/timeline" className="underline">{t("all")}</a>
            </p>
          )}
        </form>
        {since.ok && since.groups.length > 0 && (
          <>
            {/* Beside the list on a wide screen; folded on a phone (the events come first). */}
            <section className="space-y-1 max-lg:hidden">
              <h2 className="label">{seen ? t("Since your last visit") : t("The last 7 days")}</h2>
              {sinceList}
            </section>
            <details className="lg:hidden">
              <summary className="label cursor-pointer">
                {seen ? t("Since your last visit") : t("The last 7 days")} · {since.groups.length}
              </summary>
              <div className="pt-1">{sinceList}</div>
            </details>
          </>
        )}
      </div>
      <div>
        <TimelineList key={hit?.ref ?? "all"} entity={hit?.ref} limit={60} filters sources initialKinds={kinds} initialSources={sources} />
      </div>
    </div>
  );
}
