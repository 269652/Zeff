import Link from "next/link";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";

/** The report's two views — the week (/) and the month (/month) — one menu entry, switched here. */
export function ReportToggle({ view }: { view: "week" | "month" }) {
  const views = (
    [
      ["week", t("Week"), "/", "weekly-report"],
      ["month", t("Month"), "/month", "monthly-report"],
    ] as const
  ).filter(([key, , , plugin]) => key === view || isInstalled(plugin));
  if (views.length < 2) return null;
  return (
    <nav className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800" aria-label={t("Report")}>
      {views.map(([key, label, href]) => (
        <Link
          key={key}
          href={href}
          aria-current={view === key ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${view === key ? "border-indigo-600 text-zinc-900 dark:text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
