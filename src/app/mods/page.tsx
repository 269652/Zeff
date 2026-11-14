import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { ModsManager } from "@/components/mods/ModsManager";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Mods") };
}

/**
 * Mods (docs/mods.md) — beside plugins: a plugin works *in* Zeff (apps, functions, flows, views; sandboxed, with the permissions you
 * grant), a mod changes *Zeff itself* (its functions and components, through their hooks; with Zeff's rights, so on only when you say).
 */
export default async function ModsPage() {
  await connection();
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">🧬 {t("Mods")}</h1>
        <Link href="/plugins" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          {t("← Plugins")}
        </Link>
      </div>
      <p className="max-w-[75ch] text-sm text-zinc-600 dark:text-zinc-300">
        {t("Mods change Zeff itself: any of its functions and components can be changed, wrapped or replaced — without touching Zeff's code. A mod that fails is passed by (Zeff does what it did without it) and switched off when it keeps failing; one written for an older version of what it changes is held back. Plugins, by contrast, work inside Zeff — apps, functions, flows — sandboxed.")}
      </p>
      <ModsManager />
    </div>
  );
}
