import type { Metadata } from "next";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { resolveQuery } from "@/plugins/timeline/refs";
import { timelineSince } from "@/plugins/timeline/query";
import { lastSeen, timelineStats } from "@/plugins/timeline/store";
import { KIND_GROUPS, SOURCES } from "@/plugins/timeline/shared";
import { TimelineList } from "@/plugins/timeline/ui/TimelineList";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Timeline") };
}

/**
 * The Timeline: everything that happened, newest first, by day — filtered by kind, source and entity (a person, a ticket, a page …
 * by its name or ref) — with a line where your last visit was, and beside it what changed since then, by entity.
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
  return (
    <div className="page">
      <div className="page-aside space-y-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">{t("Timeline")}</h1>
          <p className="text-sm text-zinc-500">{t("What happened across your sources — mails, chats, tickets, appointments, time, todos, rows, payments, documents — and with whom. Read after every sync, by rule.")}</p>
          <p className="text-xs text-zinc-400">{t("{n} events", { n: stats.total })}</p>
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
          <section className="space-y-1">
            <h2 className="label">{seen ? t("Since your last visit") : t("The last 7 days")}</h2>
            <ul className="space-y-0.5 text-sm">
              {since.groups.map((g) => (
                <li key={g.ref} className="flex items-baseline gap-2">
                  <a href={`/timeline?ref=${encodeURIComponent(g.ref)}`} className="min-w-0 flex-1 truncate hover:underline">
                    {g.label}
                  </a>
                  <span className="text-xs text-zinc-400 tabular-nums">{g.count}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <div>
        <TimelineList key={hit?.ref ?? "all"} entity={hit?.ref} limit={60} filters sources initialKinds={kinds} initialSources={sources} />
      </div>
    </div>
  );
}
