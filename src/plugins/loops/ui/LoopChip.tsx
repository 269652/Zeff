import { t } from "@/lib/i18n/server";

/**
 * A chip for the open loops of a thread or a message (the inbox, a chat; server pages): how many you owe, how many you're owed,
 * red when one is overdue — its texts as the tip, a link to the Open loops page.
 */
export function LoopChip({ mine, theirs, overdue, texts }: { mine: number; theirs: number; overdue: number; texts: string[] }) {
  if (!mine && !theirs) return null;
  const tone = overdue ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  const label = [mine ? t("I owe {n}", { n: mine }) : "", theirs ? t("owed {n}", { n: theirs }) : ""].filter(Boolean).join(" · ");
  return (
    <a href={overdue ? "/loops?view=overdue" : "/loops"} className={`shrink-0 rounded px-1.5 text-xs ${tone}`} title={texts.slice(0, 5).join("\n")}>
      ⟳ {label}
    </a>
  );
}
