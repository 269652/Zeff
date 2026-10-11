import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import Link from "next/link";
import { connection } from "next/server";
import type { Placement } from "@/lib/layout-shared";
import { allApps } from "@/plugins/tabs";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Apps") };
}

/** Every installed plugin's application — wherever the layout puts it (header, menu, hidden). */
export default async function AppsPage() {
  await connection();
  const apps = allApps();
  const placement: Record<Placement, string> = { header: t("Header"), menu: t("Menu"), hidden: t("hidden") };
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Apps")}</h1>
        <p className="text-sm text-zinc-500">
          {t("The applications of the installed plugins. Which ones sit in the header and which in the menu: Menu → “Customize”.")}
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {apps.map((a) => (
          <li key={a.href}>
            <Link href={a.href} className="card block h-full p-4 transition hover:border-indigo-300 hover:shadow-md dark:hover:border-indigo-700">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{a.label}</span>
                <span className="text-[11px] text-zinc-400">{placement[a.place]}</span>
              </div>
              <p className="text-sm text-zinc-500">{a.hint}</p>
              <p className="mt-1 text-xs text-zinc-400">{a.pluginName}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
