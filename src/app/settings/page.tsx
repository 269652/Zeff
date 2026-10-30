import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { settingsAreas } from "@/lib/settings-areas";
import { HashRedirect } from "@/components/HashRedirect";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Settings") };
}

/**
 * Settings (/settings; was /settings/all): every settings area in one place, grouped (lib/settings-areas.ts — the menu names them alike). The time-tracking settings that were here
 * are /settings/time — an old link with their anchor (/settings#hours …) is sent there.
 */
export default async function SettingsHubPage() {
  await connection();
  const groups = settingsAreas();
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
