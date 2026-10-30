import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { PLUGINS } from "@/plugins/catalog";
import { catalogText } from "@/plugins/catalog-text";
import { installedPlugins, isInstalled } from "@/plugins/state";
import { HashRedirect } from "@/components/HashRedirect";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Settings") };
}

type Area = { href: string; label: string; what: string };

/**
 * Settings (/settings; was /settings/all): every settings area in one place, grouped. The time-tracking settings that were here
 * are /settings/time — an old link with their anchor (/settings#hours …) is sent there.
 */
export default async function SettingsHubPage() {
  await connection();
  const on = installedPlugins();
  const general: Area[] = [
    { href: "/preferences", label: t("General"), what: t("Language, parallel work, security key, lock, backups") },
    { href: "/settings/ai", label: t("AI"), what: t("Backends and models, your instructions, the prompts, how useful each step is") },
    ...(isInstalled("todos") ? [{ href: "/settings/todos", label: t("Todo settings"), what: t("The briefing, what a todo shows, which kinds of knowledge count") }] : []),
  ];
  const time: Area[] = isInstalled("zeiterfassung") || isInstalled("work") ? [{ href: "/settings/time", label: t("Time-tracking settings"), what: t("Weekly hours, breaks, flex time, rules, absences") }] : [];
  const connections: Area[] = [
    { href: "/settings/connections", label: t("Connections"), what: t("Per service: API or automation Chrome, the sign-ins, Gmail accounts, Google Drive, how often each sync runs") },
  ];
  // (Pages this hub already lists: a plugin's settings that are a section of one of them aren't listed again.)
  const listed = [...general, ...time, ...connections].map((a) => a.href.split("#")[0]);
  const plugins: Area[] = [
    { href: "/plugins", label: t("Plugins"), what: t("Install or remove connectors and AI tools") },
    ...PLUGINS.filter((p) => on.has(p.id) && p.category !== "language" && p.settings).map((p) => ({ href: p.settings!.href, label: catalogText(t, p.name), what: catalogText(t, p.settings!.what) })),
  ].filter((a, i, all) => all.findIndex((x) => x.href === a.href) === i && !listed.includes(a.href.split("#")[0]));
  const backup: Area[] = [
    ...(isInstalled("backup") ? [{ href: "/preferences#backups", label: t("Backups"), what: t("Encrypted backups and restore") }] : []),
    ...(isInstalled("accounts") ? [{ href: "/accounts", label: t("Accounts"), what: t("Separate data sets, each with its own settings") }] : []),
    { href: "/settings/mobile", label: t("Mobile access"), what: t("Zeff on your phone through Tailscale — the database stays on this computer") },
    { href: "/diagnostics", label: t("Diagnostics"), what: t("Health of the app, its syncs and the automation Chrome") },
    { href: "/privacy", label: t("What leaves this PC"), what: t("Every outgoing connection, listed") },
    { href: "/privacy/boundaries", label: t("Data boundaries"), what: t("What may flow where: open, personal, secret") },
  ];
  const groups: { id: string; title: string; areas: Area[] }[] = [
    { id: "general", title: t("General & AI"), areas: general },
    { id: "time", title: t("Time tracking"), areas: time },
    { id: "connections", title: t("Connections"), areas: connections },
    { id: "plugins", title: t("Plugins"), areas: plugins },
    { id: "backup", title: t("Backup & accounts"), areas: backup },
  ].filter((g) => g.areas.length);
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Settings")}</h1>
        <p className="text-sm text-zinc-500">{t("Every settings area, grouped. Press Ctrl+K to search them by name.")}</p>
        {/* The time-tracking settings were this page: their old anchors lead to /settings/time. */}
        <HashRedirect moves={Object.fromEntries(["hours", "breaks", "flex", "types", "report", "meetings", "absences", "work"].map((id) => [id, `/settings/time#${id}`]))} />
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
