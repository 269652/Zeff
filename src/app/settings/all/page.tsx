import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { PLUGINS } from "@/plugins/catalog";
import { catalogText } from "@/plugins/catalog-text";
import { installedPlugins, isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("All settings") };
}

type Area = { href: string; label: string; what: string };

/** The settings hub: every settings area in one place, grouped — the existing pages keep their URLs. */
export default async function SettingsHubPage() {
  await connection();
  const on = installedPlugins();
  const general: Area[] = [
    { href: "/preferences", label: t("General"), what: t("Language, AI provider, todo briefing, backups") },
    { href: "/settings/prompts", label: t("Prompts"), what: t("What the AI reads at each step") },
    ...(isInstalled("todos") ? [{ href: "/settings/todos", label: t("Todo settings"), what: t("What a todo shows, and which kinds of knowledge count") }] : []),
  ];
  const time: Area[] = isInstalled("zeiterfassung") || isInstalled("work") ? [{ href: "/settings", label: t("Time-tracking settings"), what: t("Weekly hours, breaks, flex time, rules, absences") }] : [];
  const connections: Area[] = [
    { href: "/settings/connections", label: t("Connections"), what: t("Per service: read through the automation Chrome or through its API (OAuth)") },
    { href: "/logins", label: t("Browser sign-ins"), what: t("Whether you are signed in to each site in the automation Chrome") },
  ];
  const plugins: Area[] = [
    { href: "/plugins", label: t("Plugins"), what: t("Install or remove connectors and AI tools") },
    ...PLUGINS.filter((p) => on.has(p.id) && p.category !== "language" && p.settings).map((p) => ({ href: p.settings!.href, label: catalogText(t, p.name), what: catalogText(t, p.settings!.what) })),
  ].filter((a, i, all) => all.findIndex((x) => x.href === a.href) === i && !general.some((g) => g.href === a.href) && !time.some((g) => g.href === a.href));
  const sync: Area[] = [{ href: "/sync-settings", label: t("Sync settings"), what: t("How often each sync runs") }];
  const backup: Area[] = [
    ...(isInstalled("backup") ? [{ href: "/preferences#backups", label: t("Backups"), what: t("Encrypted backups and restore") }] : []),
    ...(isInstalled("accounts") ? [{ href: "/accounts", label: t("Accounts"), what: t("Separate data sets, each with its own settings") }] : []),
    { href: "/diagnostics", label: t("Diagnostics"), what: t("Health of the app, its syncs and the automation Chrome") },
    { href: "/privacy", label: t("What leaves this PC"), what: t("Every outgoing connection, listed") },
    { href: "/privacy/boundaries", label: t("Data boundaries"), what: t("What may flow where: open, personal, secret") },
  ];
  const groups: { id: string; title: string; areas: Area[] }[] = [
    { id: "general", title: t("General & AI"), areas: general },
    { id: "time", title: t("Time tracking"), areas: time },
    { id: "connections", title: t("Connections & sign-ins"), areas: connections },
    { id: "plugins", title: t("Plugins"), areas: plugins },
    { id: "sync", title: t("Sync"), areas: sync },
    { id: "backup", title: t("Backup & accounts"), areas: backup },
  ].filter((g) => g.areas.length);
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("All settings")}</h1>
        <p className="text-sm text-zinc-500">{t("Every settings area, grouped. Press Ctrl+K to search them by name.")}</p>
      </div>
      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`hub-${g.id}`} className="space-y-2">
          <h2 id={`hub-${g.id}`} className="text-sm font-semibold text-zinc-500 uppercase">
            {g.title}
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {g.areas.map((a) => (
              <li key={a.href}>
                <Link href={a.href} className="card block p-3 transition hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:hover:bg-zinc-900">
                  <span className="block text-sm font-medium">{a.label}</span>
                  <span className="block text-xs text-zinc-500">{a.what}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
