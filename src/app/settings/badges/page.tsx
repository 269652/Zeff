import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { TodoBadgeSettings } from "@/components/todos/TodoBadgeSettings";
import { getBadgeLook } from "@/lib/badges/look-store";
import { t } from "@/lib/i18n/server";
import { getTodoBadge, openTodoCounts } from "@/lib/todos/badge-store";
import { isInstalled } from "@/plugins/state";
import { MarkSettings } from "./MarkSettings";
import { WorkspaceBadgeSettings } from "./WorkspaceBadgeSettings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Badges and dots") };
}

/** A section of the page: its heading, what it is about, its settings. */
function Section({ id, title, what, children }: { id: string; title: string; what: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="card scroll-mt-4 space-y-3 p-4">
      <div>
        <h2 id={`${id}-h`} className="text-sm font-semibold text-zinc-500 uppercase">
          {title}
        </h2>
        <p className="max-w-[75ch] text-sm text-zinc-500">{what}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * Settings → Badges (/settings/badges): every number and dot Zeff shows in one place — the Todos tab's badge, the Todos page's unseen
 * activity, the Workspace tree's badges (and what they count), the header's dots. Each section with a preview drawn by the components
 * the app uses, saved as you change it, with its own "Restore the default".
 */
export default async function BadgeSettingsPage() {
  await connection();
  const look = getBadgeLook();
  const todos = isInstalled("todos");
  const workspace = isInstalled("workspace");
  const ws = workspace ? (await import("@/plugins/workspace/badge-config-store")).getWsBadges() : null;
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("Settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("Badges and dots")}</h1>
        <p className="text-sm text-zinc-500">{t("The numbers and dots on the tabs, in the Workspace tree and in the header: which are shown, what they count, in which colour. Changes are saved at once.")}</p>
        <nav aria-label={t("On this page")} className="text-sm">
          <ul className="space-y-1">
            {todos && (
              <li>
                <a href="#todos" className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {t("Badge on the Todos tab")}
                </a>
              </li>
            )}
            {todos && (
              <li>
                <a href="#todo-activity" className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {t("Unseen activity on the Todos page")}
                </a>
              </li>
            )}
            {workspace && (
              <li>
                <a href="#workspace" className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {t("Badges in the Workspace tree")}
                </a>
              </li>
            )}
            <li>
              <a href="#header" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {t("Dots in the header")}
              </a>
            </li>
          </ul>
        </nav>
      </div>
      {todos && (
        <Section id="todos" title={t("Badge on the Todos tab")} what={t("Which numbers the badge next to “Todos” shows (in the header and the phone's bar), in which order and colours.")}>
          <TodoBadgeSettings initial={getTodoBadge()} counts={openTodoCounts() ?? { open: 0, late: 0, today: 0 }} />
        </Section>
      )}
      {todos && (
        <Section id="todo-activity" title={t("Unseen activity on the Todos page")} what={t("The count on the Todos page's Activity tab.")}>
          <MarkSettings initial={look} part="todos" />
        </Section>
      )}
      {ws && (
        <Section id="workspace" title={t("Badges in the Workspace tree")} what={t("The pills and dots beside the pages in the Workspace tree: which are shown, in which colour, and which sources they count.")}>
          <WorkspaceBadgeSettings initial={ws} />
        </Section>
      )}
      <Section id="header" title={t("Dots in the header")} what={t("The small dots on the header's tabs and buttons.")}>
        <MarkSettings initial={look} part="header" />
      </Section>
    </div>
  );
}
