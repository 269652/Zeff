import Link from "next/link";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { pagesMentioning } from "./store";

/** The Workspace pages that @-mention a person (their page shows it); nothing while the plugin is off or none do. */
export function PersonPages({ personId }: { personId: number }) {
  if (!isInstalled("workspace")) return null;
  const pages = pagesMentioning("person", personId, 12);
  if (!pages.length) return null;
  return (
    <section className="card space-y-2 p-4">
      <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Mentioned in your workspace")}</h2>
      <ul className="flex flex-wrap gap-1.5 text-sm">
        {pages.map((p) => (
          <li key={p.id}>
            <Link href={`/workspace/${p.id}`} className="rounded-md border border-zinc-200 px-2 py-0.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
              {p.icon || (p.kind === "database" ? "🗂️" : "📄")} {p.title || t("Untitled")}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
